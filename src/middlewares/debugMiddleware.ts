import { CONFIG } from '../config'
import * as crypto from '@shardus/crypto-utils'
import { nestedCountersInstance } from '../utils/nestedCounters'
import { rateLimit } from 'express-rate-limit'
import { DevSecurityLevel } from '../types'
import { RequestHandler } from 'express'
import { Utils } from '@shardus/types'

const MAX_COUNTER_BUFFER_MILLISECONDS = 10000
let lastCounter = 0
let multiSigLstCounter = 0

const limiter = rateLimit({
  windowMs: CONFIG.debugEndpointRateLimiting.window,
  limit: CONFIG.debugEndpointRateLimiting.limit,
})

/** Helper Functions */

function verify(obj: crypto.SignedObject, expectedPk?: string): boolean {
  try {
    if (expectedPk) {
      if (obj.sign.owner !== expectedPk) return false
    }
    return crypto.verifyObj(obj)
  } catch (e) {
    console.error(`Error in verifying object ${JSON.stringify(obj)}`, e)
    return false
  }
}

export function ensureKeySecurity(pubKey: string, level: number): boolean {
  const devPublicKeys = getDevPublicKeys()
  // eslint-disable-next-line security/detect-object-injection
  const pkClearance = devPublicKeys[pubKey]
  return pkClearance !== undefined && pkClearance >= level
}

export function getDevPublicKeys(): { [pubkey: string]: number } {
  return CONFIG.devPublicKeys || {}
}

// This function is used to check if the request is authorized to access the debug endpoint
export function handleDebugAuth(_req: any, res: any, next: any, authLevel: any) {
  try {
    //auth with a signature
    if (_req.query.sig != null && _req.query.sig_counter != null) {
      const devPublicKeys = getDevPublicKeys() // This should return list of public keys
      const requestSig = _req.query.sig
      // Check if signature is valid for any of the public keys
      for (const ownerPk in devPublicKeys) {
        const message = {
          route: _req.route.path,
          count: String(_req.query.sig_counter),
        }
        const sigObj = {
          route: _req.route.path,
          count: String(_req.query.sig_counter),
          requestHash: crypto.hash(Utils.safeStringify(message)),
          sign: { owner: ownerPk, sig: requestSig },
        }
        //reguire a larger counter than before. This prevents replay attacks
        const currentCounter = parseInt(sigObj.count)
        const currentTime = new Date().getTime()
        if (currentCounter > lastCounter && currentCounter <= currentTime + MAX_COUNTER_BUFFER_MILLISECONDS) {
          let verified = verify(sigObj, ownerPk)
          if (verified === true) {
            const authorized = ensureKeySecurity(ownerPk, authLevel)
            if (authorized) {
              lastCounter = currentCounter
              next()
              return
            } else {
              /* prettier-ignore */ nestedCountersInstance.countEvent( 'security', 'Authorization failed for security level: ', authLevel )
              return res.status(403).json({
                status: 403,
                message: 'FORBIDDEN!',
              })
            }
          }
        }
      }
    }
  } catch (error) {
    nestedCountersInstance.countEvent('security', 'debug unauthorized failure - exception caught')
  }

  return res.status(401).json({
    status: 401,
    message: 'Unauthorized!',
  })
}

// Middleware for low security level
export const isDebugModeMiddlewareLow = (_req: any, res: any, next: any) => {
  handleDebugAuth(_req, res, next, DevSecurityLevel.Low)
  return
}

// Middleware for medium security level
export const isDebugModeMiddlewareMedium = (_req: any, res: any, next: any) => {
  handleDebugAuth(_req, res, next, DevSecurityLevel.Medium)
  return
}

// Middleware for high security level
export const isDebugModeMiddlewareHigh = (_req: any, res: any, next: any) => {
  handleDebugAuth(_req, res, next, DevSecurityLevel.High)
  return
}

export function rateLimitedDebugAuth(middleware: RequestHandler) {
  return [limiter, middleware]
}
