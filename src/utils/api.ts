import fs from "fs/promises";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { getActiveEnvironment, ENV_PATH } from "./config.js";

export const callNetsuiteRestlet = async (payload: Record<string, any>): Promise<any> => {
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

    const url = `https://${creds.accountId}.restlets.api.netsuite.com/app/site/hosting/restlet.nl?script=${creds.scriptId}&deploy=${creds.deploymentId}`;

    const oauth = new OAuth({
        consumer: { key: creds.consumerKey, secret: creds.consumerSecret },
        signature_method: 'HMAC-SHA256',
        hash_function(base_string, key) {
            return crypto.createHmac('sha256', key).update(base_string).digest('base64');
        },
        realm: creds.accountId.toUpperCase().replace('-', '_')
    });

    const requestData = { url, method: 'POST' };
    const token = { key: creds.token, secret: creds.tokenSecret };

    // Explicitly define Headers init type for node's global fetch
    const headers = oauth.toHeader(oauth.authorize(requestData, token)) as unknown as Record<string, string>;
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
