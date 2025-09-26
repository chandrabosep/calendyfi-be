import * as crypto from "crypto";
import { config } from "../config";

const algorithm = "aes-256-cbc";
const encryptionKey = config.encryptionKey || "default-key";
const key = crypto.scryptSync(encryptionKey, "salt", 32);

export function encrypt(text: string): string {
	const iv = crypto.randomBytes(16);
	const cipher = crypto.createCipheriv(algorithm, key, iv);

	let encrypted = cipher.update(text, "utf8", "hex");
	encrypted += cipher.final("hex");

	return iv.toString("hex") + ":" + encrypted;
}

export function decrypt(encryptedText: string): string {
	const parts = encryptedText.split(":");
	if (parts.length !== 2) {
		throw new Error("Invalid encrypted text format");
	}

	const ivHex = parts[0];
	const encrypted = parts[1];

	if (!ivHex || !encrypted) {
		throw new Error("Invalid encrypted text format");
	}

	const iv = Buffer.from(ivHex, "hex");
	const decipher = crypto.createDecipheriv(algorithm, key, iv);

	let decrypted = decipher.update(encrypted, "hex", "utf8");
	decrypted += decipher.final("utf8");

	return decrypted;
}

export function generateEncryptionKey(): string {
	return crypto.randomBytes(32).toString("hex");
}
