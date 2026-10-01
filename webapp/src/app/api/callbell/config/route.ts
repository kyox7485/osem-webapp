import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function checkSecret(req: NextRequest): boolean {
  const secret = process.env.CALLBELL_API_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  const receiverId = req.nextUrl.searchParams.get('receiver_id')
  if (!receiverId || isNaN(Number(receiverId))) {
    return NextResponse.json({ ok: false, code: 'MISSING_RECEIVER_ID' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: receiver } = await supabase
    .from('cb_receivers')
    .select('id')
    .eq('id', Number(receiverId))
    .maybeSingle()

  if (!receiver) {
    return NextResponse.json({ ok: false, code: 'RECEIVER_NOT_FOUND' }, { status: 404 })
  }

  const [assignmentsResult, disarmsResult] = await Promise.all([
    supabase
      .from('cb_assignments')
      .select('device_num, resident_id, room_label, tbl_residents(resident_name)')
      .eq('receiver_id', Number(receiverId)),
    supabase
      .from('cb_disarm_events')
      .select('device_num, disarm_start, disarm_end, reason')
      .eq('receiver_id', Number(receiverId))
      .gt('disarm_end', new Date().toISOString()),
  ])

  const assignments = (assignmentsResult.data ?? []).map((a: Record<string, unknown>) => ({
    device_num: a.device_num,
    resident_id: a.resident_id,
    resident_name: (a.tbl_residents as Record<string, unknown> | null)?.resident_name ?? null,
    room_label: a.room_label,
  }))

  const disarms = (disarmsResult.data ?? []).map((d: Record<string, unknown>) => ({
    device_num: d.device_num,
    disarm_start: d.disarm_start,
    disarm_end: d.disarm_end,
    reason: d.reason,
  }))

  await supabase
    .from('cb_receivers')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', Number(receiverId))

  return NextResponse.json({ ok: true, assignments, disarms })
}
