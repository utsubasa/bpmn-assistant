const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

function hasLanes(doc) {
  const laneSets = doc.getElementsByTagName('laneSet');
  if (laneSets.length > 0) return true;
  const nsLaneSets = doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'laneSet');
  return nsLaneSets.length > 0;
}

function getProcessElement(doc) {
  let processes = doc.getElementsByTagName('process');
  if (processes.length === 0) {
    processes = doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/MODEL', 'process');
  }
  return processes.length > 0 ? processes[0] : null;
}

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

module.exports = { hasLanes, getProcessElement, parseLanes, removeLaneSet };
