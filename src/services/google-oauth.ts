import { google } from "googleapis";
import { config } from "../config";
import { GoogleTokens, GoogleUserInfo } from "../types";

export class GoogleOAuthService {
	private oauth2Client: any;

	constructor() {
		this.oauth2Client = new google.auth.OAuth2(
			config.googleClientId,
			config.googleClientSecret,
			config.googleRedirectUri
		);
	}

	getAuthUrl(): string {
		const scopes = [
			"https://www.googleapis.com/auth/calendar.readonly",
			"https://www.googleapis.com/auth/userinfo.email",
			"https://www.googleapis.com/auth/userinfo.profile",
		];

		return this.oauth2Client.generateAuthUrl({
			access_type: "offline",
			scope: scopes,
			prompt: "consent", // Force consent to get refresh token
		});
	}

	async exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
		try {
			const { tokens } = await this.oauth2Client.getToken(code);

			console.log("Successfully exchanged code for tokens", {
				hasAccessToken: !!tokens.access_token,
				hasRefreshToken: !!tokens.refresh_token,
				expiresIn: tokens.expiry_date,
			});

			return {
				access_token: tokens.access_token,
				refresh_token: tokens.refresh_token,
				expires_in: tokens.expiry_date,
				token_type: tokens.token_type,
				scope: tokens.scope,
			};
		} catch (error) {
			console.error("Failed to exchange code for tokens", { error });
			throw new Error("Failed to exchange authorization code for tokens");
		}
	}

	async getUserInfo(accessToken: string): Promise<GoogleUserInfo> {
		try {
			this.oauth2Client.setCredentials({ access_token: accessToken });

			const oauth2 = google.oauth2({
				version: "v2",
				auth: this.oauth2Client,
			});
			const { data } = await oauth2.userinfo.get();

			console.log("Successfully retrieved user info", {
				userId: data.id,
				email: data.email,
			});

			return {
				id: data.id!,
				email: data.email!,
				name: data.name!,
				picture: data.picture || undefined,
			};
		} catch (error) {
			console.error("Failed to get user info", { error });
			throw new Error("Failed to retrieve user information");
		}
	}

	async refreshAccessToken(refreshToken: string): Promise<{
		accessToken: string;
		expiresIn: number;
	}> {
		try {
			this.oauth2Client.setCredentials({ refresh_token: refreshToken });

			const { credentials } =
				await this.oauth2Client.refreshAccessToken();

			console.log("Successfully refreshed access token", {
				expiresIn: credentials.expiry_date,
			});

			return {
				accessToken: credentials.access_token,
				expiresIn: credentials.expiry_date,
			};
		} catch (error) {
			console.error("Failed to refresh access token", { error });
			throw new Error("Failed to refresh access token");
		}
	}

	setCredentials(tokens: GoogleTokens): void {
		this.oauth2Client.setCredentials({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token,
		});
	}
}

export const googleOAuthService = new GoogleOAuthService();
