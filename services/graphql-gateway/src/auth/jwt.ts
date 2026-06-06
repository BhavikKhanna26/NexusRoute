import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { appConfig } from '../config';

// Read public key once at startup — not on every request.
// RS256: private key signs (auth server only), public key verifies (gateway only).
// The gateway can verify but cannot forge tokens — it never sees the private key.
const publicKey = fs.readFileSync(
  path.resolve(process.cwd(), appConfig.JWT_PUBLIC_KEY_PATH),
  'utf8'
);

export interface SellerClaims {
  sellerId: string;
  email: string;
  role: 'seller' | 'ops' | 'admin';
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export function verifyToken(authHeader: string | undefined): SellerClaims {
  if (!authHeader?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  try {
    const payload = jwt.verify(token, publicKey, {
      algorithms: ['RS256'],
    }) as jwt.JwtPayload;

    if (!payload.sellerId || !payload.email || !payload.role) {
      throw new AuthenticationError('Token missing required claims');
    }

    return {
      sellerId: payload.sellerId as string,
      email:    payload.email as string,
      role:     payload.role as SellerClaims['role'],
    };
  } catch (err) {
    if (err instanceof AuthenticationError) throw err;
    // jwt.verify throws TokenExpiredError, JsonWebTokenError, etc.
    throw new AuthenticationError('Invalid or expired token');
  }
}
