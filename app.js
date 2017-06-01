require('dotenv').config();

const debug = require('debug')(process.env.DEBUG + ':app');

const fs = require('fs');
const readline = require('readline');
const google = require('googleapis');
const GoogleAuth = require('google-auth-library');
const git = require('nodegit');
const mv = require('mv');
const rimraf = require('rimraf');

const drive = google.drive('v3');

// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/drive-nodejs-quickstart.json
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
const TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-resume-watcher.json';

const DOCUMENT_ID = '1j187468he9kV68_rS7kUAUVD2tUEZjZeB2Brknj2QKg';
const PDF_PATH = './Andrew Brooke - Resume.pdf';
const POLLING_INTERVAL = 36000000;

// Load client secrets from a local file.
fs.readFile('client_secret.json', (err, content) => {
    if (err) {
        debug(`Error loading client secret file: ${err}`);
        return;
    }

    // Authorize a client with the loaded credentials, then call the Drive API.
    authorize(JSON.parse(content), watchDocument);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const clientSecret = credentials.installed.client_secret;
    const clientId = credentials.installed.client_id;
    const redirectUrl = credentials.installed.redirect_uris[0];
    const auth = new GoogleAuth();
    const oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) {
            getNewToken(oauth2Client, callback);
        } else {
            oauth2Client.credentials = JSON.parse(token);
            callback(oauth2Client);
        }
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES
    });
    debug('Authorize this app by visiting this url: ', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oauth2Client.getToken(code, (err, token) => {
            if (err) {
                debug('Error while trying to retrieve access token', err);
                return;
            }
            oauth2Client.credentials = token;
            storeToken(token);
            callback(oauth2Client);
        });
    });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
    try {
        fs.mkdirSync(TOKEN_DIR);
    } catch (err) {
        if (err.code != 'EEXIST') throw err;
    }
    fs.writeFile(TOKEN_PATH, JSON.stringify(token));
    debug(`Token stored to ${TOKEN_PATH}`);
}

/**
 * Watches the resume document for changes
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function watchDocument(auth) {
    // Get a start page token
    drive.changes.getStartPageToken({
        auth: auth
    }, (err, res) => {
        if (err) return debug(`Error getting start page token: ${err}`);

        let startPageToken = res.startPageToken;

        let fetchCallback = (err, newStartPageToken) => {
            debug(`Done fetching changes. Next page token: ${newStartPageToken}`);
            setTimeout(() => {
                fetchChanges(auth, newStartPageToken,
                    fetchChanges, fetchCallback);
            }, POLLING_INTERVAL);
        };

        // Start fetching changes
        fetchChanges(auth, startPageToken, fetchChanges, fetchCallback);
    });
}

/**
 * Fetches the user's Google Drive document changes
 * Checks to see if the resume document has been changed
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} pageToken  Current pageToken
 * @param {Function} pageFn   Function to execute after a page was fetched
 * @param {Function} callback Callback function to be executed
                              after changed are fetched
 */
function fetchChanges(auth, pageToken, pageFn, callback) {
    drive.changes.list({
        auth: auth,
        pageToken: pageToken
    }, (err, res) => {
        if (err) return callback(err, null);

        res.changes.forEach((change) => {
            // A change to the resume was found
            if (change.fileId === DOCUMENT_ID) {
                debug(`Change found for document ${DOCUMENT_ID}`);
                downloadAsPDF(auth);
            }
        });

        if (res.newStartPageToken) {
            // Last page, save this token for the next polling interval
            callback(null, res.newStartPageToken);
        }
        if (res.nextPageToken) {
            pageFn(auth, res.nextPageToken, pageFn, callback);
        }
    });
}

/**
 * Download the resume Google Document as a PDF
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function downloadAsPDF(auth) {
    const dest = fs.createWriteStream(PDF_PATH);
    drive.files.export({
        auth: auth,
        fileId: DOCUMENT_ID,
        mimeType: 'application/pdf'
    }).on('end', () => {
        debug('Download Complete');
        return;
        commitChanges();
    }).on('error', (err) => {
        debug('Error during download', err);
    }).pipe(dest);
}

/**
 * Commits changed PDF to andrewbrooke.github.io repository on Github
 */
function commitChanges() {
    let index, repo, oid, remote;
    const hash = Math.random().toString(36).substring(7);
    const dir = './tmp' + hash;

    git.Clone('https://github.com/andrewbrooke/andrewbrooke.github.io', dir).then((repoResult) => { // eslint-disable-line
        debug('Clone succeeded');
        repo = repoResult;
        mv(PDF_PATH, dir + '/' + PDF_PATH, (err) => {
            if (err) return debug(`Error moving file: ${err}`);

            return repo.refreshIndex().then((indexResult) => {
                debug('Index refresh succeeded');
                index = indexResult;
                return index.addAll();
            }).then(() => {
                debug('Addall succeeded');
                index.write();
                return index.writeTree();
            }).then((oidResult) => {
                debug('Write succeeded');
                oid = oidResult;
                return git.Reference.nameToId(repo, 'HEAD');
            }).then((head) => {
                return repo.getCommit(head);
            }).then((parent) => {
                let author = git.Signature.now('ResumeWatcher',
                    'andrewbrooke15@gmail.com');
                let committer = git.Signature.now('ResumeWatcher',
                    'andrewbrooke15@gmail.com');

                return repo.createCommit('HEAD', author, committer,
                    'Updated Resume ' + Date.now(), oid, [parent]);
            }).then((commitId) => {
                debug(`New Commit: ${commitId}`);
                return repo.getRemote('origin');
            }).then((remoteResult) => {
                debug('Pushing to remote');
                remote = remoteResult;

                return remote.push(
                    ['refs/heads/master:refs/heads/master'],
                    {
                        callbacks: {
                            credentials: (url, username) => {
                                return git.Cred.userpassPlaintextNew(
                                    process.env.GITHUB_USERNAME,
                                    process.env.GITHUB_PASSWORD);
                            }
                        }
                    });
            }).done(() => {
                debug('Remote pushed');
                rimraf(dir, () => {
                    debug('Deleted .tmp');
                });
            });
        });
    }).catch((err) => {
        debug(`Error in commitChanges: ${err}`);
    });
}
