import { Router, Request, Response } from "express";
import { googleOAuthService } from "../services/google-oauth";
import { prisma } from "../db/client";
import { encrypt } from "../utils/encryption";
import { ApiResponse } from "../types";

const router = Router();

// Initiate Google OAuth flow
router.get("/google", (req: Request, res: Response) => {
	try {
		const authUrl = googleOAuthService.getAuthUrl();

		console.log("OAuth flow initiated", {
			redirectUri: authUrl,
		});

		res.redirect(authUrl);
	} catch (error) {
		console.error("Failed to initiate OAuth flow", { error });
		res.status(500).json({
			success: false,
			error: "Failed to initiate OAuth flow",
		} as ApiResponse);
	}
});

// Handle OAuth callback
router.get(
	"/google/callback",
	async (req: Request, res: Response): Promise<void> => {
		try {
			const { code, error } = req.query;

			if (error) {
				console.error("OAuth error received", { error });
				res.status(400).json({
					success: false,
					error: "OAuth authorization failed",
				} as ApiResponse);
				return;
			}

			if (!code || typeof code !== "string") {
				console.error("No authorization code received");
				res.status(400).json({
					success: false,
					error: "No authorization code received",
				} as ApiResponse);
				return;
			}

			// Exchange code for tokens
			const tokens = await googleOAuthService.exchangeCodeForTokens(code);

			// Get user info
			const userInfo = await googleOAuthService.getUserInfo(
				tokens.access_token
			);

			// Encrypt refresh token
			const encryptedRefreshToken = encrypt(tokens.refresh_token);

			// Calculate token expiry
			const tokenExpiry = new Date(tokens.expires_in);

			// Upsert user in database
			const user = await prisma.user.upsert({
				where: { googleId: userInfo.id },
				update: {
					email: userInfo.email,
					name: userInfo.name,
					refreshToken: encryptedRefreshToken,
					accessToken: tokens.access_token,
					tokenExpiry: tokenExpiry,
				},
				create: {
					googleId: userInfo.id,
					email: userInfo.email,
					name: userInfo.name,
					refreshToken: encryptedRefreshToken,
					accessToken: tokens.access_token,
					tokenExpiry: tokenExpiry,
				},
			});

			console.log("User authenticated successfully", {
				userId: user.id,
				email: user.email,
				googleId: user.googleId,
			});

			// In a real app, you'd set a session cookie or JWT here
			res.json({
				success: true,
				data: {
					userId: user.id,
					email: user.email,
					name: user.name,
					message: "Authentication successful",
				},
			} as ApiResponse);
		} catch (error) {
			console.error("OAuth callback failed", { error });
			res.status(500).json({
				success: false,
				error: "Authentication failed",
			} as ApiResponse);
		}
	}
);

// Get current user info (requires session/auth middleware in real app)
router.get("/me", async (req: Request, res: Response) => {
	try {
		// This would typically get user from session/JWT
		// For now, we'll return a placeholder
		res.json({
			success: true,
			data: {
				message: "User info endpoint - implement session handling",
			},
		} as ApiResponse);
	} catch (error) {
		console.error("Failed to get user info", { error });
		res.status(500).json({
			success: false,
			error: "Failed to get user info",
		} as ApiResponse);
	}
});

export default router;
