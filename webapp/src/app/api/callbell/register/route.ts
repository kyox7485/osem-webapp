import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

function checkSecret(req: NextRequest): boolean {
  const secret = process.env.CALLBELL_API_SECRET
  if (!secret) return false
  const auth = req.headers.get('authorization') ?? ''
  return auth === `Bearer ${secret}`
}

export async function POST(req: NextRequest) {
  if (!checkSecret(req)) {
    return NextResponse.json({ ok: false, code: 'UNAUTHORIZED' }, { status: 401 })
  }

  let body: {
    branch_code: string
    receiver_label: string
    android_id?: string
    apk_version?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, code: 'BAD_REQUEST' }, { status: 400 })
  }

  if (!body.branch_code || !body.receiver_label) {
    return NextResponse.json({ ok: false, code: 'MISSING_FIELDS' }, { status: 400 })
  }

  const supabase = createAdminClient()

  const { data: branch, error: branchErr } = await supabase
    .from('tbl_branches')
    .select('"BranchID"')
    .eq('"BranchCode"', body.branch_code)
    .single()

  if (branchErr || !branch) {
    return NextResponse.json({ ok: false, code: 'BRANCH_NOT_FOUND' }, { status: 404 })
  }

  const branchId: number = (branch as Record<string, number>)['BranchID']

  // Find existing receiver by android_id + branch, or create a new one.
  let receiverId: number | null = null

  if (body.android_id) {
    const { data: existing } = await supabase
      .from('cb_receivers')
      .select('id')
      .eq('branch_id', branchId)
      .eq('android_id', body.android_id)
      .maybeSingle()

    if (existing) {
      receiverId = existing.id
      await supabase
        .from('cb_receivers')
        .update({
          receiver_label: body.receiver_label,
          apk_version: body.apk_version ?? null,
          last_seen_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', receiverId)
    }
  }

  if (receiverId === null) {
    const token = crypto.randomUUID()
    const { data: created, error: createErr } = await supabase
      .from('cb_receivers')
      .insert({
        branch_id: branchId,
        receiver_label: body.receiver_label,
        android_id: body.android_id ?? null,
        device_token: token,
        apk_version: body.apk_version ?? null,
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (createErr || !created) {
      return NextResponse.json({ ok: false, code: 'DB_ERROR' }, { status: 500 })
    }
    receiverId = created.id
  }

  return NextResponse.json({ ok: true, receiver_id: receiverId })
}
