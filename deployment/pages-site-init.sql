-- Proposed object only. Apply after exact target verification and authorized migrations.
INSERT INTO pages_site (id, project, production_branch, production_url)
SELECT 'default', 'zkyl-student-showcase', 'main', 'https://zkyl-student-showcase.pages.dev'
WHERE NOT EXISTS (SELECT 1 FROM pages_site WHERE id = 'default');
-- The executor must compare this readback exactly; never overwrite a differing row.
SELECT id, project, production_branch, production_url, current_job, current_deploy, public_revision
FROM pages_site WHERE id = 'default';
