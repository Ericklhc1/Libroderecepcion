import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/server/auth/current-user';
import { refreshSession } from '@/server/auth/session';
import { hasAcceptedCurrentTerms } from '@/server/services/legal-acceptance';
import {
  generateOperationalBrief,
  OperationalBriefError,
} from '@/server/ai/operational-brief';
import {
  ASSISTANT_FAILURE_IS_TEMPORARY,
  ASSISTANT_FAILURE_STATUS,
} from '@/domain/assistant-status';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'no-store' };

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
      { status: 401, headers },
    );
  }

  if (user.mustChangePassword || !(await hasAcceptedCurrentTerms(user.id))) {
    return NextResponse.json(
      { error: 'Debes aceptar los términos vigentes antes de utilizar Fronti.' },
      { status: 403, headers },
    );
  }

  const alive = await refreshSession(user.id, user.sessionId);
  if (!alive) {
    return NextResponse.json(
      { error: 'Tu sesión venció. Vuelve a iniciar sesión.' },
      { status: 401, headers },
    );
  }

  try {
    const result = await generateOperationalBrief(user);
    return NextResponse.json(
      {
        brief: result.brief,
        generatedAt: result.generatedAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    console.error('[fronti-brief]', error);
    if (error instanceof OperationalBriefError) {
      return NextResponse.json(
        {
          error: error.message,
          causa: error.failure,
          reintentable: ASSISTANT_FAILURE_IS_TEMPORARY[error.failure],
        },
        { status: ASSISTANT_FAILURE_STATUS[error.failure], headers },
      );
    }

    return NextResponse.json(
      { error: 'No pude generar el briefing operativo.' },
      { status: 500, headers },
    );
  }
}
