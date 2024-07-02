# SRT-AI

## Install
1. Install ffmpeg: `sudo apt install ffmpeg`
2. Clone the repo: `git clone https://github.com/ilarramendi/srt-ai`
3. Install dependencies: `npm install`
4. Clone `.env.example` to `.env` and fill in the values

## Usage
`node index.src "path/to/movie.mkv"`  
or with glob  
`node index.src "/media/movies/**/*"`  

## Parameters
`--debug` will print the original and translated text for each segment
`--ignore-existing-translation` will translate even if a existing translation in the target language already exists
`--batch` will batch translation requests in queue (extremelly recommended, this also reduces the cost in half)


## Options
| Key                 | Value                                           | Example                                                          |
|---------------------|-------------------------------------------------|------------------------------------------------------------------|
| TARGET_LANGUAGE     | Target language with first letter in upper case | Spanish                                                          |
| LANGUAGE_SHORT      | Language short name                             | es                                                               |
| EXTRA_SPECIFICATION | Extra specification for the translation         | translation must be in Latin American Spanish, not Spain Spanish |
| MAX_TOKENS          | Max tokens to send to the model                 |                                                                  |
| OPENAI_API_KEY      | OpenAI API key                                  |                                                                  |
| AI_MODEL            | OpenAI model to use                             |                                                                  |


