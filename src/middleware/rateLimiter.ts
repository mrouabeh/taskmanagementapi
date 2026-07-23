import {redisClient} from '../redis'
import type { RequestHandler } from 'express'
import { TooManyRequestsError } from '../lib/errors'

export const rateLimiter: RequestHandler = async (req,res,next)=>{
    const ip = req.ip
    const key = `rate:${ip}`
    let currentRequests: number
    try {
        currentRequests = await redisClient.incr(key)
        if (currentRequests===1){
            await redisClient.expire(key,30)
        }
    } catch (err) {
        console.error("Redis connection issue:", err);
        return next()
    }
    if (currentRequests>5) {
        const ttl = await redisClient.ttl(key)
        return next(new TooManyRequestsError(ttl, `Too many requests. Try again in ${ttl} seconds`))
    }
    next()
}
