# Finire

A minimalist 30-day writing app. 300 words a day. No going back.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

Create a `.env.local` file with your Supabase credentials:

```
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deploy to Vercel

1. Push this code to a GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in with GitHub
3. Click "New Project" and import your repository
4. Add your environment variables in the Vercel dashboard
5. Deploy

## How It Works

- Users sign up and start on Day 1
- Each day requires 300 words minimum
- Once sealed, a day becomes permanently read-only
- You cannot proceed to the next day until the current day is sealed
- Progress saves automatically as you type
