const express = require('express');
const bodyParser = require('body-parser');
const { layoutProcess } = require('bpmn-auto-layout');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

const app = express();
const port = process.env.PORT || 3001;

app.use(bodyParser.json());

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/', (req, res) => {
  console.log('Health check');
  res.json({ status: 'ok' });
});

/**
 * Detect whether the BPMN XML contains a laneSet.
 */
function hasLanes(doc) {
  // Check with and without namespace
  const laneSets = doc.getElementsByTagName('laneSet');
  if (laneSets.length > 0) return true;
  const nsLaneSets = doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'laneSet');
  return nsLaneSets.length > 0;
}

/**
 * Get the process element from the document.
 */
function getProcessElement(doc) {
  let processes = doc.getElementsByTagName('process');
  if (processes.length === 0) {
    processes = doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'process');
  }
  return processes.length > 0 ? processes[0] : null;
}

/**
 * Parse lane information from the document.
 * Returns: { lanes: [{id, name, flowNodeRefs: []}], laneSetElement }
 */
function parseLanes(doc) {
  const processEl = getProcessElement(doc);
  if (!processEl) return { lanes: [], laneSetElement: null };

  let laneSetEl = null;
  const lanes = [];

  for (let i = 0; i < processEl.childNodes.length; i++) {
    const child = processEl.childNodes[i];
    if (child.nodeType !== 1) continue;
    const tag = child.localName || child.tagName;
    if (tag === 'laneSet') {
      laneSetEl = child;
      break;
    }
  }

  if (!laneSetEl) return { lanes: [], laneSetElement: null };

  for (let i = 0; i < laneSetEl.childNodes.length; i++) {
    const laneEl = laneSetEl.childNodes[i];
    if (laneEl.nodeType !== 1) continue;
    const laneTag = laneEl.localName || laneEl.tagName;
    if (laneTag !== 'lane') continue;

    const lane = {
      id: laneEl.getAttribute('id'),
      name: laneEl.getAttribute('name') || '',
      flowNodeRefs: [],
    };

    for (let j = 0; j < laneEl.childNodes.length; j++) {
      const refEl = laneEl.childNodes[j];
      if (refEl.nodeType !== 1) continue;
      const refTag = refEl.localName || refEl.tagName;
      if (refTag === 'flowNodeRef' && refEl.textContent) {
        lane.flowNodeRefs.push(refEl.textContent.trim());
      }
    }

    lanes.push(lane);
  }

  return { lanes, laneSetElement: laneSetEl };
}

/**
 * Remove the laneSet element from the XML so bpmn-auto-layout can process it.
 */
function removeLaneSet(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'text/xml');
  const processEl = getProcessElement(doc);
  if (!processEl) return xmlStr;

  for (let i = 0; i < processEl.childNodes.length; i++) {
    const child = processEl.childNodes[i];
    if (child.nodeType !== 1) continue;
    const tag = child.localName || child.tagName;
    if (tag === 'laneSet') {
      processEl.removeChild(child);
      break;
    }
  }

  return new XMLSerializer().serializeToString(doc);
}

/**
 * 2-pass layout for processes with lanes:
 * 1. Remove laneSet -> run bpmn-auto-layout for base positions
 * 2. Group elements by lane -> reassign Y coordinates into lane bands -> add lane BPMNShapes
 */
async function layoutWithLanes(bpmnXml) {
  const doc = new DOMParser().parseFromString(bpmnXml, 'text/xml');
  const { lanes } = parseLanes(doc);

  if (lanes.length === 0) {
    // No lanes found, fall back to standard layout
    return await layoutProcess(bpmnXml);
  }

  // Step 1: Remove laneSet and get base layout
  const xmlWithoutLanes = removeLaneSet(bpmnXml);
  const layoutedXml = await layoutProcess(xmlWithoutLanes);

  // Step 2: Parse the layouted XML and redistribute elements into lane bands
  const layoutedDoc = new DOMParser().parseFromString(layoutedXml, 'text/xml');

  // Find BPMNDiagram -> BPMNPlane
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
    // Can't find plane, return as-is
    return layoutedXml;
  }

  // Collect all BPMNShape positions
  const shapePositions = {};
  for (let i = 0; i < bpmnPlane.childNodes.length; i++) {
    const child = bpmnPlane.childNodes[i];
    if (child.nodeType !== 1) continue;
    const tag = child.localName || child.tagName;
    if (tag === 'BPMNShape' || tag === 'bpmndi:BPMNShape') {
      const elementId = child.getAttribute('bpmnElement');
      // Find the Bounds child
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
  }

  // Calculate lane bands
  const LANE_PADDING = 30;
  const LANE_MIN_HEIGHT = 150;
  const LANE_HEADER_WIDTH = 30;
  const LANE_X_START = 0;

  // For each lane, find the elements and compute the needed height
  let currentY = 0;
  const laneBands = [];

  // Find overall x range for lane width
  let minX = Infinity;
  let maxXRight = 0;
  for (const pos of Object.values(shapePositions)) {
    if (pos.x < minX) minX = pos.x;
    if (pos.x + pos.width > maxXRight) maxXRight = pos.x + pos.width;
  }
  const laneWidth = Math.max(maxXRight - LANE_X_START + 100, 600);

  for (const lane of lanes) {
    // Find min/max Y for elements in this lane
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

  // Redistribute element Y positions into lane bands
  for (const band of laneBands) {
    for (const refId of band.lane.flowNodeRefs) {
      const pos = shapePositions[refId];
      if (!pos) continue;

      // Shift Y relative to lane band
      const relativeY = band.hasElements ? (pos.y - band.originalMinY) : 0;
      const newY = band.y + LANE_PADDING + relativeY;

      pos.boundsNode.setAttribute('y', String(newY));
      pos.y = newY;
    }
  }

  // Update sequence flow waypoints (BPMNEdge)
  // The Y coordinates in edges reference the original positions, so we update them
  // by building an offset map per element
  // For simplicity, we recalculate edge waypoints aren't modified here since
  // bpmn-js will re-render the connections based on element positions

  // Re-insert laneSet into the process
  const layoutedProcessEl = getProcessElement(layoutedDoc);
  if (layoutedProcessEl) {
    // Create laneSet element
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

    // Insert laneSet as first child of process
    if (layoutedProcessEl.firstChild) {
      layoutedProcessEl.insertBefore(laneSetEl, layoutedProcessEl.firstChild);
    } else {
      layoutedProcessEl.appendChild(laneSetEl);
    }
  }

  // Add BPMNShape for each lane in the diagram
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

app.post('/process-bpmn', async (req, res) => {
  const { bpmnXml } = req.body;

  try {
    const doc = new DOMParser().parseFromString(bpmnXml, 'text/xml');
    let layoutedXml;

    if (hasLanes(doc)) {
      layoutedXml = await layoutWithLanes(bpmnXml);
    } else {
      layoutedXml = await layoutProcess(bpmnXml);
    }

    res.json({ layoutedXml });
  } catch (error) {
    console.error('Error processing BPMN XML:', error);
    res.status(500).send('Failed to process BPMN XML');
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${port}`);
});
