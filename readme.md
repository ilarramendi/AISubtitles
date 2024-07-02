# AI Subtitles
![image](https://github.com/ilarramendi/srt-ai/assets/30437204/eabb5f87-4143-4ccc-bf28-058239d8e450)  
Translate text subtitles (including embedded subtitles) to any language using OpenAI's API.  

## Install
1. Install ffmpeg: `sudo apt install ffmpeg`
2. Clone the repo: `git clone https://github.com/ilarramendi/srt-ai`
3. Install dependencies: `npm install`
4. Install cli: `npm install -g .`
5. Clone `.env.example` to `.env` and edit the values

## Usage
`ai-sub "path/to/movie.mkv"`  
or for all files in a directory  
`ai-sub "path/to/movies/**/*"`  

## Parameters
`--debug` will print the original and translated text for each segment  
`--ignore-existing-translation` will translate even if a existing translation in the target language already exists  
`--batch` will batch translation requests in queue (extremely recommended, this also reduces the cost in half, takes more time but request are stored in cache)  
`--wait` will wait until all jobs are finished (only works with --batch, may take a while)  


## Options
| Key                 | Value                                                                               | Example                                                          |
|---------------------|-------------------------------------------------------------------------------------|------------------------------------------------------------------|
| TARGET_LANGUAGE     | Target language with first letter in upper case                                     | Spanish                                                          |
| LANGUAGE_SHORT      | Language short name                                                                 | es                                                               |
| EXTRA_SPECIFICATION | Extra specification for the translation                                             | Translation must be in Latin American Spanish, not Spain Spanish |
| MAX_TOKENS          | Max tokens to send to the model                                                     | 1000                                                             |
| OPENAI_API_KEY      | OpenAI API key                                                                      | sk-XXX                                                           |
| AI_MODEL            | OpenAI model to use (for better translations use gpt-4, but its 10x more expensive) | gpt-3.5-turbo                                                    |
