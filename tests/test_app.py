import io
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from bpmn_assistant.app import app, PDF_MAX_SIZE


@pytest.fixture
def client():
    """Create a test client for the FastAPI app."""
    return TestClient(app)


def test_upload_pdf_exceeds_size_limit(client):
    """Test that uploading a PDF exceeding the size limit returns 413 status."""
    # Create a file-like object that exceeds the size limit
    file_content = b"x" * (PDF_MAX_SIZE + 1)

    # Mock the UploadFile to have a size attribute
    with patch('bpmn_assistant.app.UploadFile'):
        # Create a BytesIO object to simulate file upload
        file = io.BytesIO(file_content)
        file.filename = "test.pdf"
        file.size = PDF_MAX_SIZE + 1  # Size attribute set to exceed limit

        response = client.post(
            "/upload_pdf",
            files={"file": ("test.pdf", file, "application/pdf")}
        )

        # The endpoint should return 413 Payload Too Large
        assert response.status_code == 413
        assert "File size exceeds" in response.json()["detail"]
        assert "10 MB" in response.json()["detail"]


def test_upload_pdf_valid_file_type(client):
    """Test that non-PDF files are rejected with 400 status."""
    file_content = b"This is not a PDF"
    file = io.BytesIO(file_content)

    response = client.post(
        "/upload_pdf",
        files={"file": ("test.txt", file, "text/plain")}
    )

    # Should return 400 Bad Request for non-PDF files
    assert response.status_code == 400
    assert "Only PDF files are accepted" in response.json()["detail"]


def test_upload_pdf_within_size_limit(client):
    """Test that a valid PDF within size limit is accepted (mocked extraction)."""
    # Create a small PDF-like file within the limit
    file_content = b"%PDF-1.4\n" + b"x" * 1000  # Small mock PDF content
    file = io.BytesIO(file_content)

    # Mock the extract_pdf_content function to avoid actual PDF processing
    with patch('bpmn_assistant.app.extract_pdf_content') as mock_extract:
        mock_extract.return_value = {
            "text": "Sample PDF content",
            "images": []
        }

        response = client.post(
            "/upload_pdf",
            files={"file": ("test.pdf", file, "application/pdf")}
        )

        # Should be successful and call the extraction function
        assert response.status_code == 200
        mock_extract.assert_called_once()
        assert "text" in response.json()


def test_pdf_max_size_constant():
    """Verify the PDF_MAX_SIZE constant is set to 10MB."""
    assert PDF_MAX_SIZE == 10 * 1024 * 1024
    assert PDF_MAX_SIZE == 10485760
