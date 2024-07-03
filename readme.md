# AI Subtitles
![image](https://github.com/ilarramendi/srt-ai/assets/30437204/eabb5f87-4143-4ccc-bf28-058239d8e450)  
Translate text subtitles (including embedded subtitles) to any language using OpenAI's API.  

## Install
1. Install ffmpeg: `sudo apt install ffmpeg`
2. Install `node` and `npm`
3. Install ai-sub: `npm i -g ai-sub` 
4. Copy `.env.example` to `.env` and edit the values

## Usage
`ai-sub "path/to/movie.mkv"`  
or for all files in a directory  
`ai-sub "path/to/movies/**/*"`  

## Parameters
`--debug` Print debug information  
`--batch` Batch translation requests using Open AI's Batch API (extremely recommended, allows doing double the requests, but takes a lot more time, can be restarted)  

## Options
| Key                   | Value                                                                               | Example                                                          |
|-----------------------|-------------------------------------------------------------------------------------|------------------------------------------------------------------|
| TARGET_LANGUAGE       | Target language with first letter in upper case                                     | Spanish                                                          |
| TARGET_LANGUAGE_ALIAS | Array of alias of the target language, comma separated                              | es,spa,spanish                                                   |
| EXTRA_SPECIFICATION   | Extra specification for the translation                                             | Translation must be in Latin American Spanish, not Spain Spanish |
| MAX_TOKENS            | Max tokens to send to the model                                                     | 1000                                                             |
| OPENAI_API_KEY        | OpenAI API key                                                                      | sk-XXX                                                           |
| AI_MODEL              | OpenAI model to use (for better translations use gpt-4, but its 10x more expensive) | gpt-3.5-turbo                                                    |

## Credits
This project was inspired by [yazinsai/srt-ai](https://github.com/yazinsai/srt-ai)
