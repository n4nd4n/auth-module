# Authentication Module

A complete authentication system built with NestJS backend and React frontend, featuring JWT authentication, refresh tokens, and email OTP for password reset.

## Features

- User Registration
- User Login
- JWT Access Tokens (15 min expiry)
- Refresh Tokens (7-day sliding expiry, 90-day max session age, stored hashed in DB and as HttpOnly cookies)
- Forgot Password with Email OTP
- Password Reset with OTP verification
- Protected Dashboard
- Automatic token refresh
- Rate limiting on OTP requests
- Secure password hashing with bcrypt

## Tech Stack

### Backend
- NestJS
- TypeORM
- PostgreSQL
- JWT (jsonwebtoken)
- Passport
- bcrypt
- Nodemailer
- class-validator

### Frontend
- React
- React Router
- Axios
- Vite

## Project Structure

```
auth module/
├── backend/
│   ├── src/
│   │   ├── database/entities/
│   │   │   ├── user.entity.ts
│   │   │   ├── refresh-token.entity.ts
│   │   │   └── password-reset-otp.entity.ts
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   │   ├── dto/
│   │   │   │   ├── guards/
│   │   │   │   ├── strategies/
│   │   │   │   ├── decorators/
│   │   │   │   ├── auth.controller.ts
│   │   │   │   ├── auth.service.ts
│   │   │   │   └── auth.module.ts
│   │   │   └── users/
│   │   │       ├── users.controller.ts
│   │   │       ├── users.service.ts
│   │   │       └── users.module.ts
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── package.json
│   └── tsconfig.json
└── frontend/
    ├── src/
    │   ├── context/
    │   │   └── AuthContext.jsx
    │   ├── components/
    │   │   └── ProtectedRoute.jsx
    │   ├── pages/
    │   │   ├── Login.jsx
    │   │   ├── Register.jsx
    │   │   ├── ForgotPassword.jsx
    │   │   ├── ResetPassword.jsx
    │   │   └── Dashboard.jsx
    │   ├── utils/
    │   │   └── api.js
    │   ├── App.jsx
    │   └── main.jsx
    ├── package.json
    └── vite.config.js
```

## Setup Instructions

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL (v13 or higher)
- npm or yarn

### Backend Setup

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the backend directory:
```bash
touch .env
```

4. Configure the `.env` file with your database and email credentials:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=root
DB_PASSWORD=your_password
DB_DATABASE=auth_db

# JWT
JWT_SECRET=your_jwt_secret_key_change_this_in_production
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=your_refresh_token_secret_key_change_this_in_production
REFRESH_TOKEN_EXPIRES_IN=7d
# Plain number = days (e.g. 90). A duration string with a unit also works:
# 6h, 90d, 30m, 45s. Use a short value like 6h to test the cap quickly.
MAX_SESSION_AGE_DAYS=90

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_email_password
EMAIL_FROM=your_email@gmail.com

# App
PORT=3000
NODE_ENV=development
```

5. Create the PostgreSQL database:
```sql
CREATE DATABASE auth_db;
```

6. Start the backend server:
```bash
npm run start:dev
```

The backend will run on `http://localhost:3000`

### Database Migrations

The schema is managed with TypeORM migrations (`synchronize` is disabled). Pending
migrations are applied automatically on startup (`migrationsRun: true`), so a normal
`npm run start:dev` against an empty database will create all tables.

Manual commands:
```bash
# Apply pending migrations
npm run migration:run

# Revert the most recent migration
npm run migration:revert

# Generate a new migration after changing an entity
npm run migration:generate -- src/database/migrations/YourMigrationName
```

> **Upgrading an existing database that was previously managed by `synchronize`:**
> The first migration (`InitSchema`) creates every table, so it cannot run against a
> database that already has them. Because refresh tokens are disposable session data,
> the simplest one-time transition is to reset the schema and let migrations rebuild it
> (users will need to log in again):
> ```bash
> psql -U <DB_USERNAME> -d auth_db -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
> npm run migration:run
> ```

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the frontend directory:
```bash
touch .env
```

4. Configure the `.env` file:
```env
VITE_API_URL=http://localhost:3000
```

5. Start the frontend development server:
```bash
npm run dev
```

The frontend will run on `http://localhost:5173`

## API Endpoints

### Authentication

- `POST /auth/register` - Register a new user
- `POST /auth/login` - Login user
- `POST /auth/refresh` - Refresh access token
- `POST /auth/logout` - Logout user
- `POST /auth/forgot-password` - Request password reset OTP
- `POST /auth/reset-password` - Reset password with OTP

### Users

- `GET /users/profile` - Get user profile (protected)

## Security Features

- Passwords are hashed using bcrypt (10 rounds)
- OTPs are hashed before storage
- JWT access tokens expire after 15 minutes
- Refresh tokens use a 7-day sliding expiry (extended on each rotation)
- Sessions have an absolute maximum age of 90 days (configurable via `MAX_SESSION_AGE_DAYS`; accepts a plain number of days like `90`, or a duration string with a unit like `6h`, `90d`, `30m`, `45s`)
- Refresh tokens are rotated on every refresh and the old token is revoked
- Refresh tokens are stored hashed (bcrypt over a SHA-256 digest), never in plaintext
- Refresh tokens are stored as HttpOnly cookies
- Rate limiting on OTP requests (3 requests per minute)
- Maximum 5 OTP verification attempts
- OTPs expire after 10 minutes
- All DTOs are validated using class-validator
- CORS enabled for frontend origin

## Password Requirements

Passwords must:
- Be at least 8 characters long
- Contain at least one uppercase letter
- Contain at least one lowercase letter
- Contain at least one number
- Contain at least one special character (@$!%*?&)

## Usage Flow

### Registration
1. User fills registration form (Full Name, Email, Password, Confirm Password)
2. Backend validates input and checks if email exists
3. Password is hashed and user is created
4. Access token and refresh token are generated
5. User is redirected to Dashboard

### Login
1. User enters email and password
2. Backend validates credentials
3. Access token and refresh token are generated
4. Refresh token is stored as HttpOnly cookie
5. User is redirected to Dashboard

### Forgot Password
1. User enters email
2. If email exists, a 6-digit OTP is generated and sent via email
3. OTP is hashed and stored with 10-minute expiry
4. User proceeds to reset password page

### Reset Password
1. User enters email, OTP, new password, and confirm password
2. Backend verifies OTP (checks expiry and attempts)
3. Password is hashed and updated
4. OTP is marked as used
5. All refresh tokens for the user are revoked
6. User can login with new password

### Token Refresh (sliding session)
1. When the access token expires, the frontend calls the refresh endpoint
2. Backend verifies the refresh token (signature + `jti` lookup + hash comparison)
3. Backend rejects the request if the session is older than the maximum age (90 days)
4. A new access token and a new refresh token are generated; the old refresh token is revoked
5. The new refresh token's expiry slides forward to now + 7 days, while the original session start time is preserved
6. The refresh token cookie is updated and the request is retried with the new access token

### Logout
1. User clicks logout button
2. Frontend removes tokens from localStorage
3. Backend invalidates refresh token
4. User is redirected to login page

## Development

### Backend
```bash
npm run start:dev    # Start in development mode
npm run build        # Build for production
npm run start:prod   # Start production build
```

### Frontend
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run preview      # Preview production build
```

## Production Considerations

- Change all JWT secrets to strong, random values
- Use environment variables for all sensitive data
- Enable HTTPS in production
- Set `NODE_ENV=production`
- Disable TypeORM synchronization in production
- Use a proper email service (e.g., SendGrid, AWS SES)
- Implement proper logging and monitoring
- Add rate limiting to all endpoints
- Implement CSRF protection
- Use a proper session store for refresh tokens in production
- Add input sanitization
- Implement proper error handling
- Add comprehensive logging

## License

MIT
