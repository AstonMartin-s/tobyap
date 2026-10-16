import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { senderEmbedUrl, senderView } from '@/lib/senderio';
import { Nav } from '../../../_components/Nav';

export const dynamic = 'force-dynamic';

export default async function SenderViewPage({ params }: { params: { view: string } }) {
  const session = await getSession();
  if (!session) redirect('/login');
  if (session.role !== 'admin') redirect('/reportes');

  const view = senderView(params.view);
  if (!view) redirect('/admin/senderio/overview');

  return (
    <>
      <Nav slug={session.slug} role="admin" />
      <main className="shell shell--sender">
        <iframe
          className="sender-frame"
          title={`SenderIO · ${view.label}`}
          src={senderEmbedUrl(view.id)}
          referrerPolicy="origin"
        />
      </main>
    </>
  );
}
