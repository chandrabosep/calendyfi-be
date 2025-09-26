import { googleOAuthService } from "../services/google-oauth";
import { prisma, withRetry } from "../db/client";
import { decrypt, encrypt } from "./encryption";

export class TokenRefreshService {
	async refreshUserToken(userId: string): Promise<{
		accessToken: string;
		tokenExpiry: Date;
	}> {
		try {
			const user = await withRetry(async () => {
				return await prisma.user.findUnique({
					where: { id: userId },
				});
			});

			if (!user) {
				throw new Error("User not found");
			}

			// Check if token is still valid
			if (user.tokenExpiry && user.tokenExpiry > new Date()) {
				// Token still valid - no logging needed

				return {
					accessToken: user.accessToken!,
					tokenExpiry: user.tokenExpiry,
				};
			}

			// Decrypt refresh token
			const refreshToken = decrypt(user.refreshToken);

			// Refresh the access token
			const { accessToken, expiresIn } =
				await googleOAuthService.refreshAccessToken(refreshToken);

			const tokenExpiry = new Date(expiresIn);

			// Update user with new token
			await prisma.user.update({
				where: { id: userId },
				data: {
					accessToken,
					tokenExpiry,
				},
			});

			console.log("Token refreshed successfully", {
				userId,
				expiresAt: tokenExpiry,
			});

			return { accessToken, tokenExpiry };
		} catch (error) {
			console.error("Failed to refresh token", { error, userId });
			throw new Error("Failed to refresh access token");
		}
	}

	async refreshAllExpiredTokens(): Promise<{
		refreshed: number;
		failed: number;
	}> {
		try {
			const expiredUsers = await prisma.user.findMany({
				where: {
					OR: [
						{ tokenExpiry: { lt: new Date() } },
						{ tokenExpiry: null },
					],
				},
			});

			let refreshed = 0;
			let failed = 0;

			for (const user of expiredUsers) {
				try {
					await this.refreshUserToken(user.id);
					refreshed++;
				} catch (error) {
					console.error("Failed to refresh token for user", {
						userId: user.id,
						error,
					});
					failed++;
				}
			}

			console.log("Batch token refresh completed", {
				totalUsers: expiredUsers.length,
				refreshed,
				failed,
			});

			return { refreshed, failed };
		} catch (error) {
			console.error("Batch token refresh failed", { error });
			throw new Error("Failed to refresh expired tokens");
		}
	}

	async validateAndRefreshToken(userId: string): Promise<string> {
		const { accessToken } = await this.refreshUserToken(userId);
		return accessToken;
	}
}

export const tokenRefreshService = new TokenRefreshService();
