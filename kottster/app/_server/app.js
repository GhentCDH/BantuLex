import { createApp, createIdentityProvider } from '@kottster/server';
import schema from '../../kottster-app.json';

/*
 * For security, consider moving the secret data to environment variables.
 * See https://kottster.app/docs/deploying#before-you-deploy
 */
export const app = createApp({
  schema,
  secretKey: 'Kx9mP2vQ7nR4sT6wA8yC3dF5gH1jL0e',
  kottsterApiToken: 'Bw4xN8kR2mT6vP9sA3yD7fH1jL5qC0e',

  /*
   * The identity provider configuration.
   * See https://kottster.app/docs/app-configuration/identity-provider
   */
  identityProvider: createIdentityProvider('sqlite', {
    fileName: process.env.DATABASE_PATH ?? 'app.db',

    passwordHashAlgorithm: 'bcrypt',
    jwtSecretSalt: 'Vn7kR3mP9xT2wQ5s',

    /* The root admin user credentials */
    rootUsername: 'admin',
    rootPassword: 'admin',
  }),
});
