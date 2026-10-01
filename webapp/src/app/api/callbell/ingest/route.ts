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
  }))

  const { error } = await supabase
    .from('cb_call_logs')
    .upsert(rows, { onConflict: 'receiver_id,local_id,call_time', ignoreDuplicates: true })

  if (error) {
    return NextResponse.json({ ok: false, code: 'DB_ERROR', detail: error.message }, { status: 500 })
  }

  await supabase
    .from('cb_receivers')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', body.receiver_id)

  return NextResponse.json({ ok: true, ingested: rows.length })
}
