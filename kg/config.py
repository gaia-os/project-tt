import os
from dataclasses import dataclass, field

from dotenv import load_dotenv

load_dotenv()


def _env(key: str, default: str) -> str:
    return os.getenv(key, default)


@dataclass(frozen=True)
class Settings:
    neo4j_uri: str = field(default_factory=lambda: _env("NEO4J_URI", "neo4j://localhost:7687"))
    neo4j_user: str = field(default_factory=lambda: _env("NEO4J_USER", "neo4j"))
    neo4j_password: str = field(default_factory=lambda: _env("NEO4J_PASSWORD", "password"))
    neo4j_database: str = field(default_factory=lambda: _env("NEO4J_DATABASE", "neo4j"))

    ollama_host: str = field(default_factory=lambda: _env("OLLAMA_HOST", "localhost"))
    ollama_port: int = field(default_factory=lambda: int(_env("OLLAMA_PORT", "11434")))
    llm_model: str = field(default_factory=lambda: _env("OLLAMA_LLM_MODEL", "qwen3.8:27b"))
    embed_model: str = field(default_factory=lambda: _env("OLLAMA_EMBED_MODEL", "nomic-embed-text-v2-moe"))
    num_ctx: int = field(default_factory=lambda: int(_env("OLLAMA_NUM_CTX", "24576")))

    ontology_path: str = field(default_factory=lambda: _env("ONTOLOGY_PATH", "ontology/ontology.json"))
    sources_dir: str = field(default_factory=lambda: _env("SOURCES_DIR", "raw/sources"))
    metadata_csv: str = field(default_factory=lambda: _env("METADATA_CSV", "raw/sources/articles_metadata.csv"))
    chunk_size: int = field(default_factory=lambda: int(_env("CHUNK_SIZE", "3000")))
    chunk_overlap: int = field(default_factory=lambda: int(_env("CHUNK_OVERLAP", "300")))
    vector_index_name: str = field(default_factory=lambda: _env("VECTOR_INDEX_NAME", "chunk_embeddings"))
    extract_concurrency: int = field(default_factory=lambda: int(_env("EXTRACT_CONCURRENCY", "5")))

    @property
    def ollama_url(self) -> str:
        host = self.ollama_host if "://" in self.ollama_host else f"http://{self.ollama_host}"
        return f"{host}:{self.ollama_port}"
