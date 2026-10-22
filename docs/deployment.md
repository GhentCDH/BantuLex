# Deployment

The site and the admin are deployed separately. The system Caddy on the server
serves both, as on the test server:

| Part | Deployed with | On the server |
| --- | --- | --- |
| Site (Pihka) | `just deploy` from your machine | Static files in `/data/bantulex_tst/public/` |
| Admin | Image `ghcr.io/ghentcdh/bantulex:<version>` (built by CI on `v*` tags) | Compose file in `/etc/docker/compose/bantulex_tst/`, on `127.0.0.1:8190` |
| Database | Edited by the admin | `/data/bantulex_tst/data/bantulex.db`, read by the site |

## Site

`just deploy` builds the site (`site/` plus Pihka's `core/` and
`extensions/point_map/`) and copies it with rsync to the folder that the system
Caddy serves. Only code changes need a deploy; data changes do not.

| Variable | Default | |
| --- | --- | --- |
| `BANTULEX_DEPLOY_HOST` | none, required | SSH target, e.g. `username@gcdhdockqas1` |
| `BANTULEX_DEPLOY_PUBLIC` | `/data/bantulex_tst/public` | Folder on the server |

`just` loads a `.env` in the repository root (`set dotenv-load`; the file is
gitignored), so you can set them there once:

```sh
BANTULEX_DEPLOY_HOST=username@gcdhdockqas1
```

### Several deployers

Everyone in the group `bantulex` on the server can deploy. Set up the folder
once:

```sh
sudo groupadd bantulex
sudo usermod -aG bantulex <user>          # for each deployer; they log in again after it
sudo chown -R root:bantulex /data/bantulex_tst/public
sudo find /data/bantulex_tst/public -type d -exec chmod 2775 {} +
sudo find /data/bantulex_tst/public -type f -exec chmod 664 {} +
```

The setgid bit (`2` in `2775`) makes new files and folders take the group
`bantulex`. The recipe keeps that setup: it does not copy your local group, it
sets folders to `2775` and files to `664` (`--chmod`), and it does not set
folder times (`-O`), which only the owner of a folder may do. The system Caddy
can still read everything.

## System Caddy

The site loads the database from `/database/bantulex.db`. Add these lines to
the `handle { }` block of `tst.bantulex.ugent.be`, before its `root` line, and
reload Caddy:

```caddy
@database path /database/bantulex.db
root @database /data/bantulex_tst/data
rewrite @database /bantulex.db
```

Only `bantulex.db` is served from the data folder. The system Caddy user must be
able to read it. The existing `@revalidate` and `encode` rules already apply to
`*.db`. Old sites keep working with these lines, so add them before the first
`just deploy` of this version.

The dev `Caddyfile` is a copy of this block with local paths (see
[publishing](publishing.md#web-server)).

## Admin

The admin runs from its own compose file in
`/etc/docker/compose/bantulex_tst/`. To update it, set the new image tag there
and run `docker compose pull && docker compose up -d`. The admin no longer makes
backups, so its `/app/backups` mount can go.

## Backups

To run the scheduled backups (see the [README](../README.md#backups)) on the
server, copy `backup-schedules/` next to the admin's `compose.yml` and extend
that file:

```yaml
services:
  app:
    image: ghcr.io/ghentcdh/bantulex:0.3.0
    restart: unless-stopped
    ports:
      - "127.0.0.1:8190:4444"
    volumes:
      - /data/bantulex_tst/data:/app/data
    labels:
      docker-volume-backup.stop-during-backup: bantulex

  backup:
    image: docker.io/offen/docker-volume-backup:v2.49.2
    restart: unless-stopped
    environment:
      BACKUP_STOP_DURING_BACKUP_LABEL: bantulex
      BACKUP_SOURCES: /backup/data/bantulex.db
      BACKUP_FILENAME: "bantulex-manual-%Y-%m-%dT%H-%M-%S.{{ .Extension }}"
    volumes:
      - /data/bantulex_tst/data:/backup/data:ro
      - /data/bantulex_tst/backups:/archive
      - ./backup-schedules:/etc/dockervolumebackup/conf.d:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

A manual backup: `docker compose exec backup backup`. To restore, extract the
archive first, so that a wrong archive name stops the restore before the current
database is moved:

```sh
DATA=/data/bantulex_tst
tar -xzOf "$DATA/backups/<archive>.tar.gz" /backup/data/bantulex.db > "$DATA/data/bantulex.db.restore"
docker compose stop app
mv "$DATA/data/bantulex.db" "$DATA/backups/bantulex_before_restore_$(date +%Y%m%d_%H%M%S).db"
mv "$DATA/data/bantulex.db.restore" "$DATA/data/bantulex.db"
rm -f "$DATA/data/bantulex.db-journal"
docker compose start app
```

The restored file belongs to the user who ran `tar`; uid 1000 must be able to
write it. Copy archives off the server as well: a backup on the same disk does
not help when that disk fails.
