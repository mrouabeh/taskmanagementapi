import { Router } from 'express'
import {ConflictError, InternalError, UnauthorizedError, ValidationError} from "../lib/errors";
import {auth} from "../middleware/auth";
import {db} from "../db";
import {users} from "../db/schema";
import {eq} from "drizzle-orm";
import {rateLimiter} from "../middleware/rateLimiter";
import {loginUserSchema, registerUserSchema} from "../validation/auth.schema";
import bcrypt from "bcrypt";
import jwt, {JwtPayload} from "jsonwebtoken";
import {env} from "../config/env";
import { redisClient } from "../redis"
const DUMMY_HASH="$2b$10$KIqRWTBXtc/obFflqazVnuCWXlQynmdTqcjNJbKCwPheOxXpsFqEG"
const router = Router()

router.get("/me", auth, async (req, res) => {
    const r = await db.select({
        id: users.id,
        name: users.name,
        email: users.email
    }).from(users).where(eq(users.id, req.user!.sub)).limit(1)
    if (!r[0]){
        // Valid token, but the user is gone — treat as unauthenticated.
        throw new UnauthorizedError("Authentication unverified")
    }
    return res.json({success:true,user:r[0]})
})

router.post("/login",rateLimiter,async(req,res)=>{
    const result = loginUserSchema.safeParse(req.body)
    if (!result.success){
        throw new ValidationError(result.error.flatten())
    }
    const {email,password}=result.data
    const normalizedEmail = email.toLowerCase().trim()
    const userResult = await db.select({id:users.id,hashedpassword:users.hashedpassword,name:users.name,email:users.email}).from(users).where(eq(users.email,normalizedEmail)).limit(1)
    const user = userResult[0]
    // Always run a compare, even with no user or a null stored hash, so response
    // time doesn't reveal whether the account exists.
    const passwordResult = await bcrypt.compare(password, user?.hashedpassword ?? DUMMY_HASH)
    if (!user || !passwordResult) {
        // Same message for both cases so we don't confirm which emails exist.
        throw new UnauthorizedError("Invalid email or password.")
    }
    console.log(`Success! Welcome ${user.name}`);
    const sid = crypto.randomUUID()
    const token = jwt.sign({ sub: user.id, sid }, env.JWT_SECRET, { expiresIn: '15m', jwtid:crypto.randomUUID() })
    res.cookie('token', token, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 900000
    })
    const refreshJti = crypto.randomUUID()
    const refreshToken = jwt.sign({ sub: user.id, sid }, env.REFRESH_SECRET, { expiresIn: '30d', jwtid: refreshJti })
    await redisClient.set(`family:${sid}`, refreshJti, { EX: 60 * 60 * 24 * 30 })
    res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 1000 * 60 * 60 * 24 * 30
    })
    return res.status(200).json({
        success: true,
        message: "User logged in successfully!",
        user: {
            id: user.id,
            email: user.email
        }
    });
})
// No `auth` here — the access token is expected to be expired by the time a
// client calls this. The refresh cookie is the only credential.
router.post("/refresh", rateLimiter, async (req, res) => {
    const presented = req.cookies.refreshToken
    if (!presented) throw new UnauthorizedError("Not authenticated")

    let payload: string | JwtPayload
    try {
        payload = jwt.verify(presented, env.REFRESH_SECRET)
    } catch {
        throw new UnauthorizedError("Invalid or expired token")
    }
    if (typeof payload === 'string') {
        throw new UnauthorizedError("Malformed token payload")
    }
    const sub = Number(payload.sub)
    if (!Number.isInteger(sub) || sub <= 0) {
        throw new UnauthorizedError("Malformed token payload")
    }
    const { jti, sid } = payload
    if (typeof jti !== 'string' || typeof sid !== 'string') {
        throw new UnauthorizedError("Malformed token payload")
    }

    const current = await redisClient.get(`family:${sid}`)
    if (!current) {
        // Checked before the mismatch case: `null !== jti` is also true.
        throw new UnauthorizedError("Session expired")
    }
    if (current !== jti) {
        // A spent token was replayed. We can't tell the thief from the victim,
        // so kill the whole family and make both re-authenticate.
        await redisClient.del(`family:${sid}`)
        throw new UnauthorizedError("Session revoked")
    }

    const newJti = crypto.randomUUID()
    const newRefreshToken = jwt.sign({ sub, sid }, env.REFRESH_SECRET, { expiresIn: '30d', jwtid: newJti })
    // KEEPTTL keeps the original 30-day deadline; a fresh EX would let an active
    // session renew itself forever.
    await redisClient.set(`family:${sid}`, newJti, { KEEPTTL: true })

    const newAccessToken = jwt.sign({ sub, sid }, env.JWT_SECRET, { expiresIn: '15m', jwtid: crypto.randomUUID() })
    res.cookie('token', newAccessToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 900000
    })
    res.cookie('refreshToken', newRefreshToken, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh',
        maxAge: 1000 * 60 * 60 * 24 * 30
    })
    return res.json({ success: true, message: "Token refreshed" })
})

router.post("/logout", auth, async (req, res) => {
    const { jti, exp, sid } = req.user!
    const ttl = exp - Math.floor(Date.now() / 1000)
    if (ttl > 0) {
        await redisClient.set(`denylist:${jti}`, '1', { EX: ttl })

    }
    await redisClient.del(`family:${sid}`)
    res.clearCookie('token', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict'
    })
    // `path` must match what the cookie was set with or this clears nothing.
    res.clearCookie('refreshToken', {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/auth/refresh'
    })
    return res.json({ success: true, message: "Logged out" })
})
router.post("/register",rateLimiter,async (req,res)=>{
    const result = registerUserSchema.safeParse(req.body)
    if (!result.success){
        throw new ValidationError(result.error.flatten())
    }
    const {name,email,password} =result.data
    const normalizedEmail = email.toLowerCase().trim();
    const emailResult = await db.select({id:users.id}).from(users).where(eq(users.email,normalizedEmail)).limit(1)
    if (emailResult.length>0){
        throw new ConflictError("A user with this email already exists!")
    }
    const hashedPassword = await bcrypt.hash(password, 10)

    let insertResult
    try {
        insertResult = await db.insert(users).values({name, email:normalizedEmail, hashedpassword:hashedPassword}).returning({id:users.id,email:users.email})
    } catch (err) {
        // Two concurrent signups can both pass the check above; the unique index
        // is what actually decides. 23505 = unique_violation. drizzle 1.0-rc wraps
        // DB errors, so the code can sit on `.cause` rather than the top level.
        const code = (err as { code?: string })?.code
            ?? (err as { cause?: { code?: string } })?.cause?.code
        if (code === '23505') {
            throw new ConflictError("A user with this email already exists!")
        }
        throw err
    }
    if (!insertResult || insertResult.length === 0) {
        throw new InternalError("The database failed to create the user record.")
    }
    const newUser = insertResult[0];
    console.log(`Success! User created with ID: ${newUser.id}`);
    return res.status(201).json({
        success: true,
        message: "User registered successfully!",
        user: {
            id: newUser.id,
            email: newUser.email
        }
    });
})
export default router;