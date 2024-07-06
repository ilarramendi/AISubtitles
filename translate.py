import os
from flask import Flask, request, jsonify
from unsloth import FastLanguageModel
from transformers import TextStreamer
import torch


# Disable parallelism in tokenizers
os.environ['TOKENIZERS_PARALLELISM'] = "false"

alpaca_prompt = """Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
{}

### Input:
{}

### Response:
{}"""

# Create Flask app
app = Flask(__name__)

def start():
    print("Starting server...")
    torch.cuda.empty_cache()  # Clear GPU memory

    global model, tokenizer
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name = "ilarramendi/srt-translate-gemma",
        dtype = None,
        load_in_4bit = True,
    )
    FastLanguageModel.for_inference(model)  # Enable native 2x faster inference

    app.run(host='0.0.0.0', port=45313, debug=True, use_reloader=False)



def getTranslation(text):
    inputs = tokenizer(
        [
            alpaca_prompt.format(
                "Translate the text to Spanish, return exactly the same number of lines, don't combine lines, don't remove any lines, don't split lines",
                text,
                "",  # output - leave this blank for generation!
            )
        ], return_tensors="pt").to("cuda")

    # Initialize the streaming callback
    streamer = TextStreamer(tokenizer, skip_special_tokens=True)

    # Generate translation
    outputs = model.generate(**inputs, max_new_tokens=999999, use_cache=False, streamer=streamer)

    # Decode the output tokens to get the translated text
    translated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    torch.cuda.empty_cache()

    response_part = translated_text.split("### Response:")[1].strip()
    if len(response_part.split("\n")) != len(text.split("\n")):
        print("Error: Number of lines doesn't match")
        return getTranslation(text)

    return response_part

@app.route('/translate', methods=['POST'])
def translate():
    data = request.json
    text = data.get('text', '')

    if not text:
        return jsonify({'error': 'No text provided'}), 400

    # Prepare input for the model

    return jsonify({'translated_text': getTranslation(text)})


if __name__ == '__main__':
    start()