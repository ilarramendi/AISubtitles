from local_gemma import LocalGemma2ForCausalLM
from flask import Flask, request, jsonify
from transformers import AutoTokenizer, TextStreamer
import torch

model = LocalGemma2ForCausalLM.from_pretrained("ilarramendi/srt-translate-gemma-2-1epoch", preset="memory", token="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")
tokenizer = AutoTokenizer.from_pretrained("ilarramendi/srt-translate-gemma-2-1epoch", token="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")


alpaca_prompt2 = """
You are an experienced semantic translator.
You will recieve text lines and your goal is to translate them to Spanish, remember:

- ALWAYS remove non-text content from the subtitles, like HTML tags, or anything that is not readable by a human.
- ALWAYS return the SAME number of lines
- NEVER skip any line.
- NEVER combine lines.
- ALWAYS remove branding, ads or urls that are not related to the content.

# Input
{}

# Response:
"""

def split_lines_into_chunks(lines, chunk_size=1000):
    all_tokens = []
    for line in lines:
        tokens = tokenizer.encode(line + '\n', add_special_tokens=False)
        all_tokens.extend(tokens)
    
    chunks = [all_tokens[i:i + chunk_size] for i in range(0, len(all_tokens), chunk_size)]
    return [alpaca_prompt2.format(tokenizer.decode(chunk)) for chunk in chunks]

def getTranslation(text):
    inputs = tokenizer(split_lines_into_chunks(text, chunk_size=1000), return_tensors="pt").to(model.device)

    text_streamer = TextStreamer(tokenizer)

    # Generate translation
    outputs = model.generate(**inputs, streamer = text_streamer, max_new_tokens=4000, use_cache=False)

    # Decode the output tokens to get the translated text
    translated_text = tokenizer.decode(outputs[0], skip_special_tokens=True)

    torch.cuda.empty_cache()
    
    return translated_text

app = Flask(__name__)


@app.route('/translate', methods=['POST'])
def translate():
    data = request.json
    text = data.get('text', '') # Array of strings
    
    if not text:
        return jsonify({'error': 'No text provided'}), 400

    return jsonify({'translated_text': getTranslation(text)})
    

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=45313, debug=True, use_reloader=False)

