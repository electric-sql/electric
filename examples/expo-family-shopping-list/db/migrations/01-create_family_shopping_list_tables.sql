CREATE TABLE IF NOT EXISTS family (
    family_id UUID PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    image_id UUID REFERECES image(image_id)
);

CREATE TABLE IF NOT EXISTS member (
    member_id UUID PRIMARY KEY,
    family_id UUID REFERENCES family(family_id),
    name VARCHAR(100) NOT NULL,
    image_id UUID REFERECES image(image_id)
);

CREATE TABLE IF NOT EXISTS shopping_list (
    list_id UUID PRIMARY KEY,
    family_id UUID REFERENCES family(family_id)
      NOT NULL
      ON DELETE CASCADE,
    created_by UUID REFERENCES member(member_id),
    title VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shopping_list_item (
    item_id UUID PRIMARY KEY,
    list_id INTEGER REFERENCES shopping_list(list_id)
      NOT NULL
      ON DELETE CASCADE,
    added_by UUID REFERENCES member(member_id),
    name VARCHAR(255) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    comment TEXT,
    image_id UUID REFERECES image(image_id),
    completed BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS item (
    item_id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

CREATE TABLE IF NOT EXISTS image (
    image_id UUID PRIMARY KEY,
    url VARCHAR(255) NOT NULL
);
