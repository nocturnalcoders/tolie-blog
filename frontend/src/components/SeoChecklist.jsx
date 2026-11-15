// Quick checks before publishing. Advice, not rules: nothing here blocks saving.
export function seoChecks(form) {
  const title = form.title.trim();
  const words = (form.body.match(/\S+/g) || []).length;
  const noAlt = (form.body.match(/!\[\s*\]\(/g) || []).length;
  const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
  return [
    {
      ok: title.length >= 15 && title.length <= 60,
      text: title.length > 60
        ? `Title is ${title.length} characters. Google shows about 60, so the end gets cut.`
        : title.length < 15 ? 'Title is very short. A few more words help people (and Google) know what it is about.' : 'Title length is good.',
    },
    {
      ok: form.excerpt.trim().length >= 50 && form.excerpt.trim().length <= 160,
      text: !form.excerpt.trim()
        ? 'No summary: one is made from the first lines. Writing your own (50–160 characters) usually reads better in search results and link previews.'
        : form.excerpt.trim().length > 160 ? 'Summary is long. Around 160 characters shows in full.' : form.excerpt.trim().length < 50 ? 'Summary is short. Aim for 50–160 characters.' : 'Summary length is good.',
    },
    {
      ok: noAlt === 0,
      text: noAlt ? `${noAlt} picture${noAlt === 1 ? ' has' : 's have'} no description. Write one between the [ ] for screen readers and search.` : 'Every picture has a description.',
    },
    { ok: tags.length > 0, text: tags.length ? 'Has tags.' : 'No tags yet. One or two help readers find related notes.' },
    { ok: form.topic_id !== null, text: form.topic_id !== null ? 'Has a topic.' : 'No topic yet, so it only shows under "All".' },
    {
      ok: !/^# /m.test(form.body),
      text: /^# /m.test(form.body) ? 'The text uses a top-level heading (# ). The title is already that; start sections with ## instead.' : 'Headings start at ##.',
    },
    {
      ok: words < 600 || /^##+ /m.test(form.body),
      text: words >= 600 && !/^##+ /m.test(form.body) ? `${words} words without a single subheading. A few ## sections make it easier to read.` : 'Easy to scan.',
    },
  ];
}

export default function SeoChecklist({ form }) {
  const checks = seoChecks(form);
  const todo = checks.filter((c) => !c.ok).length;
  return (
    <section className="card panel seo" aria-labelledby="seo-title">
      <span className="tab">Before you publish</span>
      <h2 id="seo-title">{todo === 0 ? 'All good' : `${todo} thing${todo === 1 ? '' : 's'} to look at`}</h2>
      <ul>
        {checks.map((c) => (
          <li key={c.text} className={c.ok ? 'ok' : 'todo'}>
            <span aria-hidden="true">{c.ok ? '✓' : '!'}</span>
            <span className="sr">{c.ok ? 'Done: ' : 'To do: '}</span>
            {c.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
