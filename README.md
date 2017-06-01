# ResumeWatcher
A Node.js app to detect changes to my personal resume Google Doc, and update my website with the new version, as a PDF

# Installation

`npm i`

Create `client_secret.json` at root directory with credentials from Google Cloud console.

Create `.env` at root directory like

```
DEBUG=resume-watcher*
NODE_ENV=development
GITHUB_USERNAME=andrewbrooke
GITHUB_PASSWORD=x
```


# TODO

- Correctly delete .tmp on push
