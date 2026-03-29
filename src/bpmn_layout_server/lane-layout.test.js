const { layoutWithLanes } = require('./lane-layout');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');

/**
 * Test suite for lane-layout.js
 * Verifies that cross-lane sequence flows are handled correctly
 * when repositioning shapes to lanes.
 */

async function testCrossLaneEdge() {
  console.log('Testing cross-lane edge handling...');

  // Create a simple BPMN XML with two lanes and a cross-lane edge
  // Lane 1: Start -> Task A
  // Lane 2: Task B -> End
  // Flow: Task A (Lane 1) -> Task B (Lane 2)
  const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <laneSet id="LaneSet_1">
      <lane id="lane1" name="Lane 1">
        <flowNodeRef>start</flowNodeRef>
        <flowNodeRef>task1</flowNodeRef>
      </lane>
      <lane id="lane2" name="Lane 2">
        <flowNodeRef>task2</flowNodeRef>
        <flowNodeRef>end</flowNodeRef>
      </lane>
    </laneSet>
    <startEvent id="start"><outgoing>start-task1</outgoing></startEvent>
    <task id="task1" name="Task A"><incoming>start-task1</incoming><outgoing>task1-task2</outgoing></task>
    <task id="task2" name="Task B"><incoming>task1-task2</incoming><outgoing>task2-end</outgoing></task>
    <endEvent id="end"><incoming>task2-end</incoming></endEvent>
    <sequenceFlow id="start-task1" sourceRef="start" targetRef="task1" />
    <sequenceFlow id="task1-task2" sourceRef="task1" targetRef="task2" />
    <sequenceFlow id="task2-end" sourceRef="task2" targetRef="end" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="start_di" bpmnElement="start">
        <dc:Bounds x="100" y="100" width="50" height="50"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task1_di" bpmnElement="task1">
        <dc:Bounds x="200" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task2_di" bpmnElement="task2">
        <dc:Bounds x="400" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_di" bpmnElement="end">
        <dc:Bounds x="550" y="100" width="50" height="50"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="start-task1_di" bpmnElement="start-task1">
        <di:waypoint x="150" y="125"/>
        <di:waypoint x="200" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="task1-task2_di" bpmnElement="task1-task2">
        <di:waypoint x="300" y="120"/>
        <di:waypoint x="350" y="120"/>
        <di:waypoint x="400" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="task2-end_di" bpmnElement="task2-end">
        <di:waypoint x="500" y="120"/>
        <di:waypoint x="550" y="125"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

  try {
    const result = await layoutWithLanes(bpmnXml);
    const doc = new DOMParser().parseFromString(result, 'text/xml');

    // Extract the cross-lane edge (task1-task2)
    const bpmnPlane = doc.getElementsByTagName('bpmndi:BPMNPlane')[0];
    let crossLaneEdge = null;

    for (let i = 0; i < bpmnPlane.childNodes.length; i++) {
      const child = bpmnPlane.childNodes[i];
      if (child.nodeType === 1) {
        const tag = child.localName || child.tagName;
        if ((tag === 'BPMNEdge' || tag === 'bpmndi:BPMNEdge') &&
            child.getAttribute('bpmnElement') === 'task1-task2') {
          crossLaneEdge = child;
          break;
        }
      }
    }

    if (!crossLaneEdge) {
      console.error('ERROR: Cross-lane edge not found in result');
      return false;
    }

    // Extract waypoints
    const waypoints = [];
    for (let i = 0; i < crossLaneEdge.childNodes.length; i++) {
      const child = crossLaneEdge.childNodes[i];
      if (child.nodeType === 1) {
        const tag = child.localName || child.tagName;
        if (tag === 'waypoint' || tag === 'di:waypoint') {
          waypoints.push({
            x: parseFloat(child.getAttribute('x') || '0'),
            y: parseFloat(child.getAttribute('y') || '0'),
          });
        }
      }
    }

    if (waypoints.length < 2) {
      console.error('ERROR: Not enough waypoints found in cross-lane edge');
      return false;
    }

    console.log('  Cross-lane edge waypoints:');
    for (let i = 0; i < waypoints.length; i++) {
      console.log(`    Waypoint ${i}: x=${waypoints[i].x}, y=${waypoints[i].y}`);
    }

    // Verify that waypoints are linearly interpolated
    if (waypoints.length > 2) {
      const firstY = waypoints[0].y;
      const lastY = waypoints[waypoints.length - 1].y;

      console.log(`  Checking linear interpolation: firstY=${firstY}, lastY=${lastY}`);

      for (let i = 1; i < waypoints.length - 1; i++) {
        const expectedRatio = i / (waypoints.length - 1);
        const expectedY = firstY + (lastY - firstY) * expectedRatio;
        const actualY = waypoints[i].y;
        const tolerance = 0.1; // Allow small floating point differences

        if (Math.abs(actualY - expectedY) > tolerance) {
          console.error(`ERROR: Waypoint ${i} interpolation failed`);
          console.error(`  Expected Y: ${expectedY}, Actual Y: ${actualY}`);
          return false;
        }
      }
      console.log('  OK: All intermediate waypoints are correctly interpolated');
    }

    console.log('PASS: Cross-lane edge handling test passed\n');
    return true;
  } catch (error) {
    console.error('ERROR: Test failed with exception:', error);
    return false;
  }
}

async function testSimpleCrossLaneFlow() {
  console.log('Testing simple cross-lane flow (2 waypoints)...');

  const bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="definitions_1">
  <process id="Process_1" isExecutable="false">
    <laneSet id="LaneSet_1">
      <lane id="lane1" name="Lane 1">
        <flowNodeRef>task1</flowNodeRef>
      </lane>
      <lane id="lane2" name="Lane 2">
        <flowNodeRef>task2</flowNodeRef>
      </lane>
    </laneSet>
    <task id="task1" name="Task A"><outgoing>task1-task2</outgoing></task>
    <task id="task2" name="Task B"><incoming>task1-task2</incoming></task>
    <sequenceFlow id="task1-task2" sourceRef="task1" targetRef="task2" />
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="task1_di" bpmnElement="task1">
        <dc:Bounds x="100" y="100" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task2_di" bpmnElement="task2">
        <dc:Bounds x="300" y="100" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="task1-task2_di" bpmnElement="task1-task2">
        <di:waypoint x="200" y="140"/>
        <di:waypoint x="300" y="140"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`;

  try {
    const result = await layoutWithLanes(bpmnXml);
    console.log('PASS: Simple cross-lane flow test passed\n');
    return true;
  } catch (error) {
    console.error('ERROR: Test failed with exception:', error);
    return false;
  }
}

async function runAllTests() {
  console.log('========================================');
  console.log('  Lane Layout Fix Verification Tests');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  if (await testSimpleCrossLaneFlow()) {
    passed++;
  } else {
    failed++;
  }

  if (await testCrossLaneEdge()) {
    passed++;
  } else {
    failed++;
  }

  console.log('========================================');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runAllTests().catch(error => {
  console.error('Fatal error running tests:', error);
  process.exit(1);
});
