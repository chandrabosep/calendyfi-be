import jwt from "jsonwebtoken";

export interface TokenPayload {
	userId: string;
	email: string;
	iat?: number;
	exp?: number;
}

export class TokenService {
	private static readonly SECRET =
		process.env.JWT_SECRET || "fallback-secret";
	private static readonly EXPIRES_IN = "7d";

	/**
	 * Generate JWT token
	 */
	static generateToken(payload: Omit<TokenPayload, "iat" | "exp">): string {
		return jwt.sign(payload, this.SECRET, { expiresIn: this.EXPIRES_IN });
	}

	/**
	 * Verify JWT token
	 */
	static verifyToken(token: string): TokenPayload {
		try {
			return jwt.verify(token, this.SECRET) as TokenPayload;
		} catch (error) {
			throw new Error("Invalid token");
		}
	}

	/**
	 * Decode token without verification (for debugging)
	 */
	static decodeToken(token: string): TokenPayload | null {
		try {
			return jwt.decode(token) as TokenPayload;
		} catch (error) {
			return null;
		}
	}
}
