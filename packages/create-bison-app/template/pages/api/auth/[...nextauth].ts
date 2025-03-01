import { prisma } from 'lib/prisma';
import { comparePasswords, hashPassword } from 'services/auth';

import NextAuth, { NextAuthOptions, Session } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { PrismaAdapter } from '@next-auth/prisma-adapter';
import { PrismaClient, Role } from '@prisma/client';

export const authOptions: NextAuthOptions = {
  adapter: CustomPrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
  },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: 'Credentials',
      type: 'credentials',
      // The credentials is used to generate a suitable form on the sign in page.
      // You can specify whatever fields you are expecting to be submitted.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        firstName: { label: 'Name', type: 'text' },
        lastName: { label: 'Name', type: 'text' },
        email: { label: 'Email', type: 'text', placeholder: 'user@domain.com' },
        password: { label: 'Password', type: 'password' },
        confirmPassword: { label: 'Confirm Password', type: 'password' },
        signUp: { label: 'Sign Up', type: 'button' },
      },
      async authorize(credentials) {
        if (!credentials || !credentials.email) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLocaleLowerCase() },
          include: { profile: true },
        });

        if (credentials.signUp === 'true') {
          // No signing up if the user already exists
          if (user) return null;

          if (credentials.password !== credentials.confirmPassword) {
            throw new Error('Passwords do not match.');
          }

          const hashedPassword = hashPassword(credentials.password);

          const newUser = await prisma.user.create({
            data: {
              profile: {
                create: {
                  firstName: credentials.firstName || '',
                  lastName: credentials.lastName || '',
                },
              },
              email: credentials.email,
              password: hashedPassword,
              roles: [Role.USER],
            },
            include: { profile: true },
          });

          return newUser;
        } else {
          if (user && user.password) {
            const isValid = comparePasswords(credentials.password, user.password);
            if (!isValid) return null;

            return user;
          } else {
            // If you return null then an error will be displayed advising the user to check their details.
            return null;

            // You can also Reject this callback with an Error thus the user will be sent to the error page with the error message as a query parameter
          }
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token }) {
      // lookup user to ensure info is up to date
      const dbUser = await prisma.user.findUnique({
        where: { id: token.sub },
        include: { profile: true },
      });

      if (!dbUser) {
        throw new Error('User Not Found!');
      }

      token.user = dbUser;

      return token;
    },
    async session({ session, token }) {
      // fill in session user from the token above

      // Drop fields we don't want client side...
      const sessionUser: Session['user'] = {
        ...token.user,
        createdAt: undefined,
        updatedAt: undefined,
        password: undefined,
        profile: {
          ...token.user.profile,
          createdAt: undefined,
          updatedAt: undefined,
        },
      };

      session.user = sessionUser;
      const roles = token?.user?.roles || [];
      session.isAdmin = roles.includes(Role.ADMIN);
      session.idToken = token.idToken;
      session.accessToken = token.accessToken;

      return session;
    },
    async redirect({ url, baseUrl }) {
      try {
        const { searchParams } = new URL(url);
        const callback = searchParams.get('callbackUrl');

        return callback ?? baseUrl;
      } catch {
        return baseUrl;
      }
    },
  },
};

export default NextAuth(authOptions);

// Prisma Adapter with Customizations
function CustomPrismaAdapter(p: PrismaClient) {
  const prismaAdapter = PrismaAdapter(p);

  // Override User Create call with additional data
  prismaAdapter.createUser = (data) => {
    return p.user.create({ data: { ...data, roles: [Role.USER] } });
  };

  return prismaAdapter;
}
