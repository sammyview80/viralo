FROM python:3.10-slim

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV VIRALO_API_KEY='your_live_key_here'

EXPOSE 8000
CMD ["uvicorn", "mcp_svc.server:app", "--host", "0.0.0.0", "--port", "8000"]