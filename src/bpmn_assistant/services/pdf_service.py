import base64
import io

import pdfplumber


def extract_pdf_content(pdf_bytes: bytes) -> dict:
    """
    Extract text and page images from a PDF file.

    Args:
        pdf_bytes: Raw PDF file bytes.

    Returns:
        dict with:
            - "text": Extracted text from all pages.
            - "images": List of base64-encoded page images (PNG).
    """
    text_parts: list[str] = []
    images: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)

            # Render page as image for vision-capable LLMs
            page_image = page.to_image(resolution=150)
            img_buffer = io.BytesIO()
            page_image.save(img_buffer, format="PNG")
            img_buffer.seek(0)
            b64_image = base64.b64encode(img_buffer.read()).decode("utf-8")
            images.append(f"data:image/png;base64,{b64_image}")

    return {
        "text": "\n\n".join(text_parts),
        "images": images,
    }
