import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { verifyToken, type SellerClaims, AuthenticationError } from './auth/jwt';
import { createRoutingDecisionLoader } from './loaders/routing.loader';
import { GraphQLError } from 'graphql';

export interface GraphQLContext {
  seller: SellerClaims;
  correlationId: string;
  loaders: {
    routingDecision: ReturnType<typeof createRoutingDecisionLoader>;
  };
}

// Called by Apollo Server on every request.
// Returns the context object available to all resolvers.
export async function buildContext({ req }: { req: Request }): Promise<GraphQLContext> {
  // Correlation ID: use the one forwarded from the frontend, or generate a new one.
  // This ties logs across Gateway → Order Service → Routing Service for one request.
  const correlationId =
    (req.headers['x-correlation-id'] as string) ?? uuidv4();

  let seller: SellerClaims;
  try {
    seller = verifyToken(req.headers.authorization);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      throw new GraphQLError(err.message, {
        extensions: { code: 'UNAUTHENTICATED' },
      });
    }
    throw err;
  }

  return {
    seller,
    correlationId,
    // Loaders are instantiated per-request — never reuse across requests.
    loaders: {
      routingDecision: createRoutingDecisionLoader(),
    },
  };
}
