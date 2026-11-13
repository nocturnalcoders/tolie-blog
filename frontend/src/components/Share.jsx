import { useEffect, useRef, useState } from 'react';

// Instagram and TikTok can't take a link from a website, so for them we hand over a
// story picture (and put the link on the clipboard for the link sticker).
export default function Share({ slug, title }) {
  const url = `${window.location.origin}/post/${slug}`;
  const storyUrl = `/og/${encodeURIComponent(slug)}/story.png`;
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const story = useRef(null);
  const canShareFiles = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  // Phones need the picture ready the moment the button is tapped, or the share sheet is blocked.
  useEffect(() => {
    if (!canShareFiles) return undefined;
    let alive = true;
    fetch(storyUrl)
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (alive && blob) story.current = new File([blob], `${slug}-story.png`, { type: 'image/png' });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [canShareFiles, slug, storyUrl]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  };

  const onCopy = async () => setNote((await copyLink()) ? 'Link copied.' : `Copy this link: ${url}`);

  const onStory = async () => {
    setBusy(true);
    const copied = await copyLink();
    const linkNote = copied ? 'The link is copied, paste it into a link sticker.' : `Add ${url} as a link sticker.`;
    try {
      const file = story.current;
      if (file && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        setNote(`Pick Instagram or TikTok. ${linkNote}`);
      } else {
        const res = await fetch(storyUrl);
        if (!res.ok) throw new Error('no picture');
        const href = URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = href;
        a.download = `${slug}-story.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(href), 10000);
        setNote(`Story picture saved. Post it on Instagram or TikTok. ${linkNote}`);
      }
    } catch (err) {
      if (err.name !== 'AbortError') setNote('Couldn’t make the story picture. Try again in a moment.');
    }
    setBusy(false);
  };

  const onMore = () => navigator.share({ title, url }).catch(() => {});

  return (
    <section className="share" aria-label="Share this note">
      <span className="share-label">Share</span>
      <a className="btn react" href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noopener noreferrer">
        LinkedIn
      </a>
      <button className="react" type="button" disabled={busy} onClick={onStory}>Instagram / TikTok story</button>
      {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
        <button className="react" type="button" onClick={onMore}>More…</button>
      )}
      <button className="react" type="button" onClick={onCopy}>Copy link</button>
      {note && <p className="note" role="status">{note}</p>}
    </section>
  );
}
