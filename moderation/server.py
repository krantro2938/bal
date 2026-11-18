"""Toxicity score for a comment, used by bal before publishing it.

POST /score {"text": "..."} -> {"toxicity": 0.03, "labels": {"insult": 0.01, ...}}

Model: cointegrated/rubert-tiny-toxicity (MIT), the ONNX export from onnx-community.
Small enough for one CPU core: a comment scores in a few milliseconds.
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODEL_DIR = os.environ.get("MODEL_DIR", "/model")
LABELS = ["non-toxic", "insult", "obscenity", "threat", "dangerous"]

tokenizer = Tokenizer.from_file(f"{MODEL_DIR}/tokenizer.json")
tokenizer.enable_truncation(max_length=256)
opts = ort.SessionOptions()
opts.intra_op_num_threads = 1
opts.inter_op_num_threads = 1
session = ort.InferenceSession(f"{MODEL_DIR}/model.onnx", opts, providers=["CPUExecutionProvider"])
input_names = {i.name for i in session.get_inputs()}


def score(text: str) -> dict:
    enc = tokenizer.encode(text)
    feed = {
        "input_ids": np.array([enc.ids], dtype=np.int64),
        "attention_mask": np.array([enc.attention_mask], dtype=np.int64),
    }
    if "token_type_ids" in input_names:
        feed["token_type_ids"] = np.array([enc.type_ids], dtype=np.int64)
    p = 1 / (1 + np.exp(-session.run(None, feed)[0][0]))
    # The model card's aggregate: the text is not "non-toxic", or it is "dangerous".
    toxicity = 1 - p[0] * (1 - p[4])
    return {"toxicity": round(float(toxicity), 4), "labels": {k: round(float(v), 4) for k, v in zip(LABELS, p)}}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            self.reply(200, {"ok": True})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/score":
            return self.reply(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            if n > 64 << 10:
                return self.reply(413, {"error": "too large"})
            text = json.loads(self.rfile.read(n))["text"]
            if not isinstance(text, str):
                raise ValueError("text must be a string")
        except (ValueError, KeyError, TypeError) as e:
            return self.reply(400, {"error": str(e)})
        self.reply(200, score(text))

    def reply(self, status, body):
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass  # comment text must not end up in logs


if __name__ == "__main__":
    score("прогрев")
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
