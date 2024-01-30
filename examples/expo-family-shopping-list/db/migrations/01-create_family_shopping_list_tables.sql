
CREATE TABLE IF NOT EXISTS image (
    image_id UUID PRIMARY KEY,
    image_base_64 TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family (
    family_id UUID PRIMARY KEY,
    name VARCHAR NOT NULL,
    image_id UUID REFERENCES image(image_id)
);

CREATE TABLE IF NOT EXISTS member (
    member_id UUID PRIMARY KEY,
    family_id UUID NOT NULL
        REFERENCES family(family_id)
        ON DELETE CASCADE,
    name TEXT NOT NULL,
    image_id UUID REFERENCES image(image_id)
);

CREATE TABLE IF NOT EXISTS shopping_list (
    list_id UUID PRIMARY KEY,
    family_id UUID NOT NULL
        REFERENCES family(family_id)
        ON DELETE CASCADE,
    title VARCHAR NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS shopping_list_item (
    item_id UUID PRIMARY KEY,
    list_id UUID NOT NULL
        REFERENCES shopping_list(list_id)
        ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL,
    added_at TIMESTAMPTZ NOT NULL,
    name VARCHAR NOT NULL,
    quantity INTEGER NOT NULL,
    comment TEXT,
    image_id UUID REFERENCES image(image_id),
    completed BOOLEAN NOT NULL
);

ALTER TABLE image ENABLE ELECTRIC;
ALTER TABLE family ENABLE ELECTRIC;
ALTER TABLE member ENABLE ELECTRIC;
ALTER TABLE shopping_list ENABLE ELECTRIC;
ALTER TABLE shopping_list_item ENABLE ELECTRIC;
