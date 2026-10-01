import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function checkSecret(req: NextRequest): boolean {
  const secret = process.env.CALLBELL_API_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

interface CallRecord {
  _id: number
  DEVICE_NUM: string
  NAME: string
  CALL_TYPE: string
  IS_CANCEL_CALL: string
  IS_CALL: string
  CALL_TIME: string
  RESPONSE_TIME: string
  DURATION: string
  SEX: string
  LEVEL: string
  REMARK: string
  CONTACT_NUMBER: string
  NICK_NAME?: string
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: { receiver_id: number; records: CallRecord[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!body.receiver_id || !Array.isArray(body.records)) {
    return NextResponse.json({ ok: false, code: 'MISSING_FIELDS' }, { status: 400 })
  }

  if (body.records.length === 0) {
    return NextResponse.json({ ok: true, ingested: 0 })
  }

  const supabase = createAdminClient()

  const { data: receiver } = await supabase
    .from('cb_receivers')
    .select('id')
    .eq('id', body.receiver_id)
    .maybeSingle()

  if (!receiver) {
    return NextResponse.json({ ok: false, code: 'RECEIVER_NOT_FOUND' }, { status: 404 })
  }

  const rows = body.records.map((r) => ({
    receiver_id: body.receiver_id,
    local_id: Number(r._id),
    device_num: r.DEVICE_NUM ?? '',
    resident_name_snapshot: r.NAME || null,
    call_type: r.CALL_TYPE || null,
    is_cancel_call: r.IS_CANCEL_CALL || null,
    is_call: r.IS_CALL || null,
    call_time: r.CALL_TIME ? Number(r.CALL_TIME) : null,
    response_time: r.RESPONSE_TIME ? Number(r.RESPONSE_TIME) : null,
    duration: r.DURATION || null,
    sex: r.SEX || null,
    level: r.LEVEL || null,
    remark: r.REMARK || null,
    contact_number: r.CONTACT_NUMBER || null,
    // Resident name the receiver recorded at call time (immutable history).
    resident_nickname: r.NICK_NAME || null,
  }))

  const { error } = await supabase
    .from('cb_call_logs')
    // Merge (not ignore): the receiver fills RESPONSE_TIME in later on the
    // same record and the APK re-sends it, and a FULL DATABASE SYNC backfills.
    .upsert(rows, { onConflict: 'receiver_id,local_id,call_time' })

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', detail: error.message }, { status: 500 })
  }

  // Pressing a bell again while its call is still open makes the receiver move
  // CALL_TIME on the same record, so an earlier unanswered copy (same local_id,
  // older call_time) is left behind — remove it.
  const latestCallTime = new Map(rows.map((r) => [r.local_id, r.call_time ?? 0]))
  const { data: openRows } = await supabase
    .from('cb_call_logs')
    .select('id, local_id, call_time')
    .eq('receiver_id', body.receiver_id)
    .in('local_id', [...latestCallTime.keys()])
    .is('response_time', null)
  const stale = (openRows ?? [])
    .filter((o) => Number(o.call_time) < (latestCallTime.get(Number(o.local_id)) ?? 0))
    .map((o) => o.id)
  if (stale.length > 0) await supabase.from('cb_call_logs').delete().in('id', stale)

  await supabase
    .from('cb_receivers')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', body.receiver_id)

  return NextResponse.json({ ok: true, ingested: rows.length })
}
