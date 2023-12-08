INSERT INTO notification_templates (template_id, type, title, message, action, created_at)
VALUES
  (
    gen_random_uuid(),
    'hello',
    NULL,
    '{{first_name}} says hello!',
    'Say hello',
    NOW()
  ),
  (
    gen_random_uuid(),
    'like',
    '{{first_name}} likes your style!',
    '{{first_name}} seems to really like your {{item}} - you can thank them for the compliment!',
    'Thank you',
    NOW()
  );