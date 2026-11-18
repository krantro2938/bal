# Toxicity scoring sidecar for comments (see server.py).
FROM python:3.12-slim
RUN pip install --no-cache-dir onnxruntime==1.20.1 tokenizers==0.21.0 numpy==2.2.1
ARG REPO=https://huggingface.co/onnx-community/rubert-tiny-toxicity-ONNX/resolve/3c117322c91030ff04846b72e15509ae7f5232f1
ADD --checksum=sha256:d39a12d945b616bc3c09c5b3cbe7ad5266672a3b6f4a6d346bffaed17c4562e9 ${REPO}/onnx/model.onnx /model/model.onnx
ADD --checksum=sha256:064a132db204e46351abb4c3acb9da22fc4a837390be3b87877e79212e10dffa ${REPO}/tokenizer.json /model/tokenizer.json
RUN chmod -R a+rX /model
COPY server.py /app/server.py
USER 10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
CMD ["python", "/app/server.py"]
