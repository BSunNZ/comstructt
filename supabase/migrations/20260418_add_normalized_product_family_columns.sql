alter table if exists normalized_products
  add column if not exists family_name text,
  add column if not exists family_key text,
  add column if not exists variant_label text,
  add column if not exists variant_attributes jsonb not null default '[]'::jsonb;

create index if not exists idx_normalized_products_family_name
  on normalized_products (family_name);

create index if not exists idx_normalized_products_family_key
  on normalized_products (family_key);

create index if not exists idx_normalized_products_variant_label
  on normalized_products (variant_label);

create index if not exists idx_normalized_products_variant_attributes
  on normalized_products using gin (variant_attributes);

update normalized_products
set
  family_name = coalesce(family_name, packaging::jsonb ->> 'familyName'),
  family_key = coalesce(family_key, packaging::jsonb ->> 'familyKey'),
  variant_label = coalesce(variant_label, packaging::jsonb ->> 'variantLabel'),
  variant_attributes = case
    when variant_attributes = '[]'::jsonb
      and (packaging::jsonb ? 'variantAttributes')
    then packaging::jsonb -> 'variantAttributes'
    else variant_attributes
  end
where packaging is not null
  and packaging <> '';
