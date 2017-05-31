require('dotenv').config();

const debug = require('debug')(process.env.DEBUG + ':app');

const fs = require('fs');
const readline = require('readline');
const google = require('googleapis');
const GoogleAuth = require('google-auth-library');

const drive = google.drive('v3');

// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/drive-nodejs-quickstart.json
const SCOPES = ['https://www.googleapis.com/auth/drive'];
const TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
const TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-resume-watcher.json';

const DOCUMENT_ID = '1j187468he9kV68_rS7kUAUVD2tUEZjZeB2Brknj2QKg';

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
        if (err) return debug(err);

        let fetchCallback = (err, res) => {
            debug(`Done fetching changes. Next page token: ${res}`);
            setTimeout(() => {
                fetchChanges(auth, res, fetchChanges, fetchCallback);
            }, 5000);
        };

        // Start fetching changes
        fetchChanges(auth, res.startPageToken, fetchChanges, fetchCallback);
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
    }, function(err, res) {
        if (err) return callback(err, null);

        res.changes.forEach(function(change) {
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
    const dest = fs.createWriteStream('./resume.pdf');
    drive.files.export({
        auth: auth,
        fileId: DOCUMENT_ID,
        mimeType: 'application/pdf'
    }).on('end', function() {
        debug('Download Complete');
    }).on('error', function(err) {
        debug('Error during download', err);
    }).pipe(dest);
}
