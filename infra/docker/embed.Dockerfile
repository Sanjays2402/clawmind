FROM python:3.11-slim
WORKDIR /app
COPY packages/embed/python /app/python
RUN pip install --no-cache-dir -r python/requirements.txt
EXPOSE 7411
CMD ["uvicorn", "python.server:app", "--host", "0.0.0.0", "--port", "7411"]
