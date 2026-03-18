import pytest

from bpmn_assistant.services.validate_bpmn import validate_bpmn


class TestValidateBpmn:

    def test_validate_bpmn_duplicate_id(self, duplicate_id_process):
        with pytest.raises(ValueError) as exc_info:
            validate_bpmn(duplicate_id_process)

        assert str(exc_info.value) == "Duplicate element ID found: task1"

    def test_validate_bpmn_with_valid_lanes(self, process_with_lanes, lanes_definition):
        """Lanes validation should pass when all lane references are valid."""
        validate_bpmn(process_with_lanes, lanes=lanes_definition)

    def test_validate_bpmn_with_invalid_lane_reference(self, process_with_invalid_lane, lanes_definition):
        """Lanes validation should fail when a lane reference is invalid."""
        with pytest.raises(ValueError) as exc_info:
            validate_bpmn(process_with_invalid_lane, lanes=lanes_definition)

        assert "invalid_lane" in str(exc_info.value)

    def test_validate_bpmn_without_lanes_still_works(self, linear_process):
        """Process without lanes should still validate normally."""
        validate_bpmn(linear_process)
