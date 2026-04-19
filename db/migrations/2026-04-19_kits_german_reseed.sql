-- ============================================================================
-- Kits: German reseed + relaxed match_kits RPC
-- ----------------------------------------------------------------------------
-- 1. Adds search_keywords (text[]) and task_description (text) columns to
--    public.kits so the construction-agent edge function can build a richer
--    embedding text and so callers can filter on keyword overlap.
-- 2. Replaces the legacy 6 English kits with 15 German kits whose
--    product_name strings actually exist in public.normalized_products
--    (verified manually against the live catalog).
-- 3. Replaces match_kits with a version that:
--      - takes match_threshold (default 0.30 — was hard-coded order-by-only)
--      - returns search_keywords + task_description so the client can show
--        the matched keyword in the UI
--      - filters out anything below the threshold so the agent doesn't
--        return random low-similarity kits.
-- ----------------------------------------------------------------------------

-- 1. New columns on kits ------------------------------------------------------
alter table public.kits add column if not exists search_keywords text[] not null default '{}';
alter table public.kits add column if not exists task_description text;

-- 2. Wipe the old English seed and the dependent kit_items. The CASCADE on
--    kit_items.kit_id takes care of children.
delete from public.kits;

-- 3. Insert 15 German kits ---------------------------------------------------
insert into public.kits (slug, name, trade, description, task_description, keywords, search_keywords)
values
  ('sanitaer-set',     'Sanitär-Set',           'Sanitär',     'Silikon, Dichtmittel und Werkzeug für Bad-Fugen.',                'Bad-Fugen erneuern, Dusche abdichten',                       array['sanitär','silikon','fugen','dichten'], array['fugen','silikon','bad','dusche','abdichten','dichten','dichtstoff','fuge']),
  ('fugen-bad',        'Fugen-Set Bad',         'Sanitär',     'Komplettpaket für Sanitärfugen mit transparentem Silikon.',      'Fugen im Bad neu ziehen',                                     array['fugen','silikon','bad'],                array['fugen','silikon','bad','küche','dusche','sanitär','fuge','abdichten']),
  ('trockenbau-wand',  'Trockenbau-Wand',       'Trockenbau',  'Spachtel und Werkzeug für Trockenbauwände.',                     'Trockenbauwand spachteln und glätten',                        array['trockenbau','rigips','gipskarton'],     array['trockenbau','rigips','gipskarton','wand','spachtel','spachteln','wände']),
  ('elektro-rohbau',   'Elektro-Rohbau',        'Elektro',     'Kabel, Kabelbinder und Verlängerungen für Elektro-Rohbau.',      'Elektro-Rohbau verkabeln',                                    array['elektro','kabel','rohbau'],             array['elektro','kabel','strom','verkabeln','nym','elektroinstallation','steckdose']),
  ('elektro-verkabelung','Elektro-Verkabelung', 'Elektro',     'Kabel NYM-J 3x1.5 und 5x2.5 plus Kabelbinder für Verkabelung.',  'Verkabelung in der Wohnung legen',                            array['kabel','nym','verkabelung'],            array['kabel','nym','verkabelung','strom','elektro','wohnung','leitung']),
  ('schrauben-set',    'Schrauben-Set',         'Befestigung', 'Schrauben in den Standardgrößen 4x40, 5x60 und 6x80.',           'Holz oder Trockenbau verschrauben',                           array['schrauben','befestigung'],              array['schrauben','schraube','tx20','tx25','torx','befestigung','befestigen','verschrauben']),
  ('duebel-set',       'Dübel-Set',             'Befestigung', 'Kunststoff-Dübel 6/8/10 mm für Wandmontagen.',                   'Etwas an der Wand befestigen',                                array['dübel','befestigung','wand'],           array['dübel','duebel','wand','befestigen','befestigung','montage','bohren','aufhängen']),
  ('fliesen-verlegen', 'Fliesen verlegen',      'Fliesen',     'Fliesenkreuze und Werkzeug fürs Fliesenlegen.',                  'Fliesen im Bad oder Küche verlegen',                          array['fliesen','verlegen','kreuze'],          array['fliesen','verlegen','kreuze','bad','küche','boden','wand','fliesenleger']),
  ('kabel-verlaengerung','Kabel-Verlängerung',  'Elektro',     'Verlängerungskabel und Kabeltrommel für Baustelle.',             'Strom auf der Baustelle verteilen',                           array['verlängerung','kabel','strom'],         array['verlängerung','verlaengerung','kabel','strom','trommel','baustelle','strom','steckdose']),
  ('werkzeug-spachtel','Spachtel-Werkzeug',     'Handwerkzeug','Spachtel 50 und 100 mm für Spachtel- und Putzarbeiten.',         'Wand spachteln',                                              array['spachtel','werkzeug'],                  array['spachtel','spachteln','glätten','glatt','wand','putz','handwerkzeug']),
  ('beton-trennen',    'Beton-Trennen',         'Werkzeug',    'Betontrennscheibe für Winkelschleifer.',                          'Beton oder Stein schneiden',                                  array['beton','trennscheibe','schneiden'],     array['beton','trennen','schneiden','flex','winkelschleifer','trennscheibe','stein']),
  ('silikon-transparent','Silikon transparent', 'Sanitär',     'Transparentes Silikon für Küche und Bad.',                       'Glasflächen oder neutrale Fugen abdichten',                   array['silikon','transparent','fugen'],        array['silikon','transparent','fuge','fugen','glas','küche','bad','dichten']),
  ('silikon-weiss',    'Silikon weiß',          'Sanitär',     'Weißes Silikon für Sanitärbereich.',                              'Weiße Fugen ziehen',                                          array['silikon','weiß','sanitär'],             array['silikon','weiss','weiß','sanitär','fugen','fuge','bad']),
  ('kabelbinder-set',  'Kabelbinder-Set',       'Elektro',     'Kabelbinder 200 und 300 mm für Kabelmanagement.',                'Kabel ordentlich zusammenfassen',                             array['kabelbinder','befestigung'],            array['kabelbinder','binder','kabel','zusammen','bündeln','elektro']),
  ('fliesenkreuze-set','Fliesenkreuze-Set',     'Fliesen',     'Fliesenkreuze 3 und 5 mm für saubere Fugenbreiten.',             'Fliesen mit gleichmäßigen Fugen verlegen',                    array['fliesenkreuze','fliesen','fugen'],      array['fliesenkreuze','kreuze','fliesen','fuge','fugen','verlegen','breite'])
on conflict (slug) do nothing;

-- 4. Seed kit_items. product_name strings are matched server-side via ILIKE
--    against normalized_products.product_name OR family_name. Verified:
--      - "Silikon transparent", "Silikon weiß", "Spachtel 100mm", "Spachtel 50mm"
--      - "Schraube 4x40 / TX20", "Schraube 5x60 / TX20", "Schraube 6x80 / TX25"
--      - "Dübel 6mm" / "Dübel 8mm" / "Dübel 10mm"
--      - "Fliesenkreuze 3mm" / "Fliesenkreuze 5mm"
--      - "Kabel NYM-J 3x1.5" / "Kabel NYM-J 5x2.5"
--      - "Kabelbinder 200mm" / "Kabelbinder 300mm" / "Kabelbinder 200x4.8mm"
--      - "Kabeltrommel", "Verlängerungskabel 10m" / "20m"
--      - "Betontrennscheibe"
with k as (select id, slug from public.kits)
insert into public.kit_items (kit_id, product_id, product_name, unit, per_m2, base_qty, display_order)
select k.id, t.product_id::uuid, t.product_name, t.unit, t.per_m2::numeric, t.base_qty::int, t.ord::int
from k
join (values
  -- sanitaer-set: 1x silikon transparent + 1x silikon weiß + 1x spachtel
  ('sanitaer-set',       'lookup', 'Silikon transparent',          'Stk', null, 1, 1),
  ('sanitaer-set',       'lookup', 'Silikon weiß',                 'Stk', null, 1, 2),
  ('sanitaer-set',       'lookup', 'Spachtel 50mm',                'Stk', null, 1, 3),
  -- fugen-bad
  ('fugen-bad',          'lookup', 'Silikon transparent',          'Stk', null, 2, 1),
  ('fugen-bad',          'lookup', 'Spachtel 50mm',                'Stk', null, 1, 2),
  -- trockenbau-wand
  ('trockenbau-wand',    'lookup', 'Spachtel 100mm',               'Stk', null, 1, 1),
  ('trockenbau-wand',    'lookup', 'Spachtel 50mm',                'Stk', null, 1, 2),
  ('trockenbau-wand',    'lookup', 'Schraube 4x40 / TX20',         'Pack', null, 1, 3),
  -- elektro-rohbau
  ('elektro-rohbau',     'lookup', 'Kabel NYM-J 3x1.5',            'Rolle', null, 1, 1),
  ('elektro-rohbau',     'lookup', 'Kabel NYM-J 5x2.5',            'Rolle', null, 1, 2),
  ('elektro-rohbau',     'lookup', 'Kabelbinder 200mm',            'Pack', null, 1, 3),
  -- elektro-verkabelung
  ('elektro-verkabelung','lookup', 'Kabel NYM-J 3x1.5',            'Rolle', null, 2, 1),
  ('elektro-verkabelung','lookup', 'Kabelbinder 300mm',            'Pack', null, 1, 2),
  -- schrauben-set
  ('schrauben-set',      'lookup', 'Schraube 4x40 / TX20',         'Pack', null, 1, 1),
  ('schrauben-set',      'lookup', 'Schraube 5x60 / TX20',         'Pack', null, 1, 2),
  ('schrauben-set',      'lookup', 'Schraube 6x80 / TX25',         'Pack', null, 1, 3),
  -- duebel-set
  ('duebel-set',         'lookup', 'Dübel 6mm',                    'Pack', null, 1, 1),
  ('duebel-set',         'lookup', 'Dübel 8mm',                    'Pack', null, 1, 2),
  ('duebel-set',         'lookup', 'Dübel 10mm',                   'Pack', null, 1, 3),
  -- fliesen-verlegen
  ('fliesen-verlegen',   'lookup', 'Fliesenkreuze 3mm',            'Pack', null, 1, 1),
  ('fliesen-verlegen',   'lookup', 'Fliesenkreuze 5mm',            'Pack', null, 1, 2),
  -- kabel-verlaengerung
  ('kabel-verlaengerung','lookup', 'Verlängerungskabel 10m',       'Stk', null, 1, 1),
  ('kabel-verlaengerung','lookup', 'Verlängerungskabel 20m',       'Stk', null, 1, 2),
  ('kabel-verlaengerung','lookup', 'Kabeltrommel',                 'Stk', null, 1, 3),
  -- werkzeug-spachtel
  ('werkzeug-spachtel',  'lookup', 'Spachtel 50mm',                'Stk', null, 1, 1),
  ('werkzeug-spachtel',  'lookup', 'Spachtel 100mm',               'Stk', null, 1, 2),
  -- beton-trennen
  ('beton-trennen',      'lookup', 'Betontrennscheibe',            'Stk', null, 1, 1),
  -- silikon-transparent
  ('silikon-transparent','lookup', 'Silikon transparent',          'Stk', null, 2, 1),
  -- silikon-weiss
  ('silikon-weiss',      'lookup', 'Silikon weiß',                 'Stk', null, 2, 1),
  -- kabelbinder-set
  ('kabelbinder-set',    'lookup', 'Kabelbinder 200mm',            'Pack', null, 1, 1),
  ('kabelbinder-set',    'lookup', 'Kabelbinder 300mm',            'Pack', null, 1, 2),
  -- fliesenkreuze-set
  ('fliesenkreuze-set',  'lookup', 'Fliesenkreuze 3mm',            'Pack', null, 1, 1),
  ('fliesenkreuze-set',  'lookup', 'Fliesenkreuze 5mm',            'Pack', null, 1, 2)
) as t(slug, product_id, product_name, unit, per_m2, base_qty, ord)
  on (k.slug = t.slug);

-- 5. Replace match_kits with a threshold-aware variant. Keep the old
--    signature working (match_count int default 1) by adding match_threshold
--    with a sensible default and dropping the old function first to allow
--    the return-table change.
drop function if exists public.match_kits(vector, int);
drop function if exists public.match_kits(vector, int, float);

create or replace function public.match_kits(
  query_embedding   vector(1536),
  match_count       int default 3,
  match_threshold   float default 0.30
)
returns table (
  kit_id             uuid,
  slug               text,
  name               text,
  trade              text,
  description        text,
  task_description   text,
  keywords           text[],
  search_keywords    text[],
  similarity         float,
  items              jsonb
)
language sql
stable
as $$
  with ranked as (
    select
      k.id,
      k.slug,
      k.name,
      k.trade,
      k.description,
      k.task_description,
      k.keywords,
      k.search_keywords,
      1 - (k.embedding <=> query_embedding) as similarity
    from public.kits k
    where k.embedding is not null
    order by k.embedding <=> query_embedding
    limit match_count
  )
  select
    r.id as kit_id,
    r.slug,
    r.name,
    r.trade,
    r.description,
    r.task_description,
    r.keywords,
    r.search_keywords,
    r.similarity,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'product_id',   ki.product_id,
            'product_name', ki.product_name,
            'unit',         ki.unit,
            'per_m2',       ki.per_m2,
            'base_qty',     ki.base_qty
          )
          order by ki.display_order
        )
        from public.kit_items ki
        where ki.kit_id = r.id
      ),
      '[]'::jsonb
    ) as items
  from ranked r
  where r.similarity >= match_threshold;
$$;
