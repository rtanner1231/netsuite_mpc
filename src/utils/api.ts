import fs from "fs/promises";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { getActiveEnvironment, ENV_PATH } from "./config.js";

export const callNetsuiteRestlet = async (payload: Record<string, any>): Promise<any> => {
    const creds = await getCredentials();
    const url = `https://${creds.accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=${creds.scriptId}&deploy=${creds.deploymentId}`;

    const headers = generateOAuthHeaders(url, 'POST', creds);
    headers['Content-Type'] = 'application/json';

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NetSuite RESTlet HTTP Error ${response.status}: ${errorText}`);
    }

    return await response.json();
};

async function getCredentials() {
    const environment = await getActiveEnvironment();

    let envData: Record<string, any>;
    try {
        const envFile = await fs.readFile(ENV_PATH, "utf-8");
        envData = JSON.parse(envFile);
    } catch (error: any) {
        throw new Error(`Failed to read env.json at ${ENV_PATH}: ${error.message}`);
    }

    const creds = envData[environment];
    if (!creds) {
        throw new Error(`Credentials for environment '${environment}' not found in env.json`);
    }
    
    return creds;
}

function generateOAuthHeaders(url: string, method: string, creds: Record<string, any>) {
    const oauth = new OAuth({
        consumer: { key: creds.consumerKey, secret: creds.consumerSecret },
        signature_method: 'HMAC-SHA256',
        hash_function(base_string, key) {
            return crypto.createHmac('sha256', key).update(base_string).digest('base64');
        },
        realm: creds.accountId.toUpperCase().replace('-', '_')
    });

    const requestData = { url, method };
    const token = { key: creds.token, secret: creds.tokenSecret };

    return oauth.toHeader(oauth.authorize(requestData, token)) as unknown as Record<string, string>;
}

export const fetchNetsuiteMetadata = async (tableid: string): Promise<string> => {
    const creds = await getCredentials();
    const formattedAccountId = creds.accountId.toLowerCase().replace(/_/g, '-');
    const url = `https://${formattedAccountId}.suitetalk.api.netsuite.com/services/rest/record/v1/metadata-catalog?select=${tableid}`;

    const headers = generateOAuthHeaders(url, 'GET', creds);
    headers['Accept'] = 'application/swagger+json';

    const response = await fetch(url, {
        method: 'GET',
        headers
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`NetSuite Metadata HTTP Error ${response.status}: ${errorText}`);
    }

    return await response.text();
};
