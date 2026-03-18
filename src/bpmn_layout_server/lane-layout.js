const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { layoutProcess } = require('bpmn-auto-layout');
const { getProcessElement, parseLanes, removeLaneSet } = require('./xml-utils');

const LANE_PADDING = 30;
const LANE_MIN_HEIGHT = 150;
const LANE_HEADER_WIDTH = 30;
const LANE_X_START = 0;

async function layoutWithLanes(bpmnXml) {
  const doc = new DOMParser().parseFromString(bpmnXml, 'text/xml');
  const { lanes } = parseLanes(doc);

  if (lanes.length === 0) {
    return await layoutProcess(bpmnXml);
  }

  const xmlWithoutLanes = removeLaneSet(bpmnXml);
  const layoutedXml = await layoutProcess(xmlWithoutLanes);

  const layoutedDoc = new DOMParser().parseFromString(layoutedXml, 'text/xml');

  let bpmnPlane = null;
  const diagrams = layoutedDoc.getElementsByTagName('bpmndi:BPMNDiagram');
  if (diagrams.length > 0) {
    for (let i = 0; i < diagrams[0].childNodes.length; i++) {
      const child = diagrams[0].childNodes[i];
      if (child.nodeType === 1 && (child.localName === 'BPMNPlane' || child.tagName === 'bpmndi:BPMNPlane')) {
        bpmnPlane = child;
        break;
      }
    }
  }

  if (!bpmnPlane) {
    return layoutedXml;
  }

  const shapePositions = {};
  const edgesById = {}; // Map sequence flow IDs to their waypoints

  for (let i = 0; i < bpmnPlane.childNodes.length; i++) {
    const child = bpmnPlane.childNodes[i];
    if (child.nodeType !== 1) continue;
    const tag = child.localName || child.tagName;
    if (tag === 'BPMNShape' || tag === 'bpmndi:BPMNShape') {
      const elementId = child.getAttribute('bpmnElement');
      for (let j = 0; j < child.childNodes.length; j++) {
        const bounds = child.childNodes[j];
        if (bounds.nodeType !== 1) continue;
        const boundsTag = bounds.localName || bounds.tagName;
        if (boundsTag === 'Bounds' || boundsTag === 'dc:Bounds') {
          shapePositions[elementId] = {
            shapeNode: child,
            boundsNode: bounds,
            x: parseFloat(bounds.getAttribute('x') || '0'),
            y: parseFloat(bounds.getAttribute('y') || '0'),
            width: parseFloat(bounds.getAttribute('width') || '100'),
            height: parseFloat(bounds.getAttribute('height') || '80'),
          };
        }
      }
    }
    // Collect all BPMNEdges with their waypoints
    if (tag === 'BPMNEdge' || tag === 'bpmndi:BPMNEdge') {
      const bpmnElement = child.getAttribute('bpmnElement');
      if (bpmnElement) {
        const waypoints = [];
        // Collect all waypoints for this edge
        for (let j = 0; j < child.childNodes.length; j++) {
          const waypoint = child.childNodes[j];
          if (waypoint.nodeType !== 1) continue;
          const waypointTag = waypoint.localName || waypoint.tagName;
          if (waypointTag === 'waypoint' || waypointTag === 'di:waypoint') {
            waypoints.push(waypoint);
          }
        }
        edgesById[bpmnElement] = waypoints;
      }
    }
  }

  // Build map of flow element IDs to their connected sequence flows
  const flowsBySourceTarget = {};
  const processEl = getProcessElement(layoutedDoc);
  if (processEl) {
    for (let i = 0; i < processEl.childNodes.length; i++) {
      const child = processEl.childNodes[i];
      if (child.nodeType !== 1) continue;
      const tag = child.localName || child.tagName;
      if (tag === 'sequenceFlow') {
        const sourceRef = child.getAttribute('sourceRef');
        const targetRef = child.getAttribute('targetRef');
        const flowId = child.getAttribute('id');
        if (sourceRef) {
          if (!flowsBySourceTarget[sourceRef]) flowsBySourceTarget[sourceRef] = [];
          flowsBySourceTarget[sourceRef].push(flowId);
        }
        if (targetRef) {
          if (!flowsBySourceTarget[targetRef]) flowsBySourceTarget[targetRef] = [];
          flowsBySourceTarget[targetRef].push(flowId);
        }
      }
    }
  }

  let currentY = 0;
  const laneBands = [];

  let minX = Infinity;
  let maxXRight = 0;
  for (const pos of Object.values(shapePositions)) {
    if (pos.x < minX) minX = pos.x;
    if (pos.x + pos.width > maxXRight) maxXRight = pos.x + pos.width;
  }
  const laneWidth = Math.max(maxXRight - LANE_X_START + 100, 600);

  for (const lane of lanes) {
    let laneMinY = Infinity;
    let laneMaxY = -Infinity;
    let hasElements = false;

    for (const refId of lane.flowNodeRefs) {
      const pos = shapePositions[refId];
      if (pos) {
        hasElements = true;
        if (pos.y < laneMinY) laneMinY = pos.y;
        if (pos.y + pos.height > laneMaxY) laneMaxY = pos.y + pos.height;
      }
    }

    const contentHeight = hasElements ? (laneMaxY - laneMinY) : 0;
    const laneHeight = Math.max(contentHeight + LANE_PADDING * 2, LANE_MIN_HEIGHT);

    laneBands.push({
      lane,
      y: currentY,
      height: laneHeight,
      originalMinY: hasElements ? laneMinY : 0,
      hasElements,
    });

    currentY += laneHeight;
  }

  for (const band of laneBands) {
    for (const refId of band.lane.flowNodeRefs) {
      const pos = shapePositions[refId];
      if (!pos) continue;

      const relativeY = band.hasElements ? (pos.y - band.originalMinY) : 0;
      const newY = band.y + LANE_PADDING + relativeY;
      const yShift = newY - pos.y;

      pos.boundsNode.setAttribute('y', String(newY));
      pos.y = newY;

      // Update waypoints of connected BPMNEdges
      const connectedFlows = flowsBySourceTarget[refId];
      if (connectedFlows) {
        for (const flowId of connectedFlows) {
          const waypoints = edgesById[flowId];
          if (waypoints) {
            for (const waypoint of waypoints) {
              const currentY = parseFloat(waypoint.getAttribute('y') || '0');
              const newWaypointY = currentY + yShift;
              waypoint.setAttribute('y', String(newWaypointY));
            }
          }
        }
      }
    }
  }

  const layoutedProcessEl = getProcessElement(layoutedDoc);
  if (layoutedProcessEl) {
    const nsURI = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
    const laneSetEl = layoutedDoc.createElementNS(nsURI, 'laneSet');
    laneSetEl.setAttribute('id', 'LaneSet_1');

    for (const lane of lanes) {
      const laneEl = layoutedDoc.createElementNS(nsURI, 'lane');
      laneEl.setAttribute('id', lane.id);
      laneEl.setAttribute('name', lane.name);

      for (const refId of lane.flowNodeRefs) {
        const refEl = layoutedDoc.createElementNS(nsURI, 'flowNodeRef');
        refEl.textContent = refId;
        laneEl.appendChild(refEl);
      }

      laneSetEl.appendChild(laneEl);
    }

    if (layoutedProcessEl.firstChild) {
      layoutedProcessEl.insertBefore(laneSetEl, layoutedProcessEl.firstChild);
    } else {
      layoutedProcessEl.appendChild(laneSetEl);
    }
  }

  if (bpmnPlane) {
    const diNS = 'http://www.omg.org/spec/BPMN/20100524/DI';
    const dcNS = 'http://www.omg.org/spec/DD/20100524/DC';

    for (const band of laneBands) {
      const laneShape = layoutedDoc.createElementNS(diNS, 'bpmndi:BPMNShape');
      laneShape.setAttribute('id', `${band.lane.id}_di`);
      laneShape.setAttribute('bpmnElement', band.lane.id);
      laneShape.setAttribute('isHorizontal', 'true');

      const laneBounds = layoutedDoc.createElementNS(dcNS, 'dc:Bounds');
      laneBounds.setAttribute('x', String(LANE_X_START));
      laneBounds.setAttribute('y', String(band.y));
      laneBounds.setAttribute('width', String(laneWidth));
      laneBounds.setAttribute('height', String(band.height));

      laneShape.appendChild(laneBounds);
      bpmnPlane.appendChild(laneShape);
    }
  }

  return new XMLSerializer().serializeToString(layoutedDoc);
}

module.exports = { layoutWithLanes };
