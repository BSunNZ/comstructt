import PyPDF2

def extract_text(pdf_path):
    text = ""
    with open(pdf_path, "rb") as f:
        reader = PyPDF2.PdfReader(f)
        for page in reader.pages:
            text += page.extract_text() + "\n"
    with open("pdf_text.txt", "w", encoding="utf-8") as out:
        out.write(text)

extract_text("thinc!_Hackathon_Case-Study_I_comstruct.pdf")
