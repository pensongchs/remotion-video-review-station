import { KeyboardEvent, PointerEvent, useEffect, useMemo, useRef, useState } from 'react';

type ToolMode = 'box';
type AnnotationStatus = 'todo' | 'done';
type ReviewScene = {
  id: string;
  title: string;
  start: number;
  end: number;
};
type ReviewVideo = {
  id: string;
  title: string;
  videoUrl: string;
  sourcePath?: string;
  scenes?: ReviewScene[];
};
type ReviewManifest = {
  title: string;
  videoUrl?: string;
  sourcePath?: string;
  createdAt?: string;
  scenes?: ReviewScene[];
  videos?: ReviewVideo[];
};
type Annotation = {
  id: number;
  videoId: string;
  time: number;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  mode: ToolMode;
  note: string;
  status: AnnotationStatus;
};
type DraftShape = {
  x: number;
  y: number;
  width: number;
  height: number;
  endX: number;
  endY: number;
};
type PendingAnnotation = {
  shape: DraftShape;
  mode: ToolMode;
  time: number;
  videoId: string;
};

const emptyVideo: ReviewVideo = {
  id: 'empty',
  title: '等待导入视频',
  videoUrl: '',
  scenes: [],
};
const annotationFrameWindow = 0.12;
const clearedSessionKey = 'review-station-cleared-session-created-at';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(time: number) {
  const minutes = Math.floor(time / 60);
  const seconds = Math.floor(time % 60);
  const decimal = Math.floor((time % 1) * 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${decimal}`;
}

function normalizeVideo(manifest: ReviewManifest | null): ReviewVideo[] {
  if (!manifest) {
    return [];
  }
  if (manifest.videos?.length) {
    return manifest.videos.map((video, index) => ({
      ...video,
      id: video.id || `video-${index + 1}`,
    }));
  }
  if (manifest.videoUrl) {
    return [
      {
        id: 'video-1',
        title: manifest.title || '当前预览视频',
        videoUrl: manifest.videoUrl,
        sourcePath: manifest.sourcePath,
        scenes: manifest.scenes || [],
      },
    ];
  }
  return [];
}

function buildSubmissionPrompt({
  title,
  videos,
  annotations,
}: {
  title: string;
  videos: ReviewVideo[];
  annotations: Annotation[];
}) {
  const lines = [
    `请根据下面的审片意见，直接修改对应 Remotion 视频项目并重新渲染成新版视频。`,
    '',
    `项目: ${title}`,
    `提交时间: ${new Date().toLocaleString('zh-CN')}`,
    `视频数量: ${videos.length}`,
    '',
    `要求:`,
    `1. 不要只整理文档，请直接按意见修改画面。`,
    `2. 修改完成后重新渲染视频，输出到原项目的 renders 或对应输出目录。`,
    `3. 每条意见都要按时间点和选框位置定位，优先修改选框范围内的问题。`,
    `4. 如果某条意见需要改代码、文案、布局或素材，请直接在对应 Remotion 文件里处理。`,
    '',
  ];

  videos.forEach((video, videoIndex) => {
    const videoAnnotations = annotations.filter((item) => item.videoId === video.id);
    lines.push(`## 视频 ${videoIndex + 1}: ${video.title}`);
    if (video.sourcePath) {
      lines.push(`源文件: ${video.sourcePath}`);
    }
    if (videoAnnotations.length === 0) {
      lines.push('修改意见: 无');
      lines.push('');
      return;
    }
    videoAnnotations
      .slice()
      .sort((a, b) => a.time - b.time)
      .forEach((item, index) => {
        const scene = video.scenes?.find((sceneItem) => item.time >= sceneItem.start && item.time <= sceneItem.end);
        lines.push(`### ${index + 1}. ${formatTime(item.time)}`);
        if (scene) {
          lines.push(`镜头: ${scene.title}`);
        }
        lines.push(
          `选框位置: 左上 x=${item.x.toFixed(1)}%, y=${item.y.toFixed(1)}%, 宽=${(item.width || 0).toFixed(1)}%, 高=${(item.height || 0).toFixed(1)}%`,
        );
        lines.push(`修改建议: ${item.note}`);
        lines.push('');
      });
  });

  return lines.join('\n');
}

function App() {
  const [projectTitle, setProjectTitle] = useState('视频审片预览台');
  const [videos, setVideos] = useState<ReviewVideo[]>([]);
  const [activeVideoId, setActiveVideoId] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [noteText, setNoteText] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotation | null>(null);
  const [videoAspect, setVideoAspect] = useState(16 / 9);
  const [submissionPrompt, setSubmissionPrompt] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const activeVideo = useMemo(
    () => videos.find((video) => video.id === activeVideoId) || videos[0] || emptyVideo,
    [activeVideoId, videos],
  );
  const activeVideoAnnotations = annotations.filter((item) => item.videoId === activeVideo.id);
  const visibleAnnotations = activeVideoAnnotations.filter(
    (item) => Math.abs(item.time - currentTime) <= annotationFrameWindow,
  );
  const todoCount = annotations.filter((item) => item.status === 'todo').length;
  const activeVideoTodoCount = activeVideoAnnotations.filter((item) => item.status === 'todo').length;

  useEffect(() => {
    fetch('/review-sessions/current.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then(async (manifest: ReviewManifest | null) => {
        const clearedAt = window.localStorage.getItem(clearedSessionKey);
        if (manifest?.createdAt && clearedAt && manifest.createdAt <= clearedAt) {
          setProjectTitle('视频审片预览台');
          setVideos([]);
          setActiveVideoId('');
          return;
        }
        const nextVideos = normalizeVideo(manifest);
        if (!nextVideos.length) {
          setVideos([]);
          setActiveVideoId('');
          return;
        }
        const existingVideos = (
          await Promise.all(
            nextVideos.map(async (video) => {
              try {
                const response = await fetch(video.videoUrl, { method: 'HEAD', cache: 'no-store' });
                return response.ok ? video : null;
              } catch {
                return null;
              }
            }),
          )
        ).filter((video): video is ReviewVideo => Boolean(video));

        setProjectTitle(manifest?.title || existingVideos[0]?.title || '视频审片预览台');
        setVideos(existingVideos);
        setActiveVideoId(existingVideos[0]?.id || '');
        setCurrentTime(0);
        setIsPlaying(false);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isPlaying) {
      void video.play();
    } else {
      video.pause();
    }
  }, [isPlaying, activeVideo.videoUrl]);

  useEffect(() => {
    function handleSpaceToggle(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, button, [contenteditable="true"]')) {
        return;
      }
      if (event.code !== 'Space' || !activeVideo.videoUrl || pendingAnnotation || submissionPrompt) {
        return;
      }
      event.preventDefault();
      setIsPlaying((current) => !current);
    }

    window.addEventListener('keydown', handleSpaceToggle);
    return () => window.removeEventListener('keydown', handleSpaceToggle);
  }, [activeVideo.videoUrl, pendingAnnotation, submissionPrompt]);

  function getPoint(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return { x: 0, y: 0 };
    }
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  }

  function setPending(shape: DraftShape, mode: ToolMode) {
    if (!activeVideo.videoUrl) {
      return;
    }
    const normalized = {
      x: shape.x,
      y: shape.y,
      width: Math.abs(shape.endX - shape.x),
      height: Math.abs(shape.endY - shape.y),
      endX: shape.endX,
      endY: shape.endY,
    };
    setPendingAnnotation({
      shape: normalized,
      mode,
      time: Number(currentTime.toFixed(1)),
      videoId: activeVideo.id,
    });
  }

  function savePendingAnnotation() {
    if (!pendingAnnotation || !noteText.trim()) {
      return;
    }
    setAnnotations((current) => [
      {
        id: Date.now(),
        videoId: pendingAnnotation.videoId,
        time: pendingAnnotation.time,
        mode: pendingAnnotation.mode,
        note: noteText.trim(),
        status: 'todo',
        ...pendingAnnotation.shape,
      },
      ...current,
    ]);
    setPendingAnnotation(null);
    setNoteText('');
  }

  function handleNoteKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }
    event.preventDefault();
    savePendingAnnotation();
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('button, input, textarea, video')) {
      return;
    }
    if (!activeVideo.videoUrl) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = getPoint(event);
    setIsPlaying(false);
    setPendingAnnotation(null);
    setDraftShape({ ...point, width: 0, height: 0, endX: point.x, endY: point.y });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!draftShape) {
      return;
    }
    const point = getPoint(event);
    setDraftShape({
      ...draftShape,
      width: Math.max(point.x - draftShape.x, 0),
      height: Math.max(point.y - draftShape.y, 0),
      endX: point.x,
      endY: point.y,
    });
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!draftShape) {
      return;
    }
    if (draftShape.width < 1.2 || draftShape.height < 1.2) {
      setDraftShape(null);
      return;
    }
    setPending(draftShape, 'box');
    setDraftShape(null);
  }

  function selectVideo(videoId: string) {
    setActiveVideoId(videoId);
    setCurrentTime(0);
    setIsPlaying(false);
    setPendingAnnotation(null);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
    }
  }

  function seek(time: number) {
    setCurrentTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }

  function toggleStatus(id: number) {
    setAnnotations((current) =>
      current.map((item) => (item.id === id ? { ...item, status: item.status === 'todo' ? 'done' : 'todo' } : item)),
    );
  }

  function removeAnnotation(id: number) {
    setAnnotations((current) => current.filter((item) => item.id !== id));
  }

  function clearCurrentMarks() {
    setAnnotations((current) => current.filter((item) => item.videoId !== activeVideo.id));
    setPendingAnnotation(null);
  }

  function clearAllMarks() {
    setAnnotations([]);
    setPendingAnnotation(null);
  }

  function clearVideoList() {
    setIsPlaying(false);
    setCurrentTime(0);
    setVideos([]);
    setActiveVideoId('');
    setProjectTitle('视频审片预览台');
    setAnnotations([]);
    setDraftShape(null);
    setPendingAnnotation(null);
    setSubmissionPrompt('');
    setCopyStatus('');
    window.localStorage.setItem(clearedSessionKey, new Date().toISOString());
  }

  function submitRevisionRequest() {
    const content = buildSubmissionPrompt({ title: projectTitle, videos, annotations });
    setSubmissionPrompt(content);
    setCopyStatus('');
    window.localStorage.setItem(
      'review-station-submission',
      JSON.stringify({
        title: projectTitle,
        createdAt: new Date().toISOString(),
        prompt: content,
        annotations,
        videos,
      }),
    );
    void navigator.clipboard?.writeText(content).catch(() => undefined);
  }

  function copySubmissionPrompt() {
    void navigator.clipboard?.writeText(submissionPrompt).catch(() => undefined);
    setCopyStatus('复制成功');
    window.setTimeout(() => {
      setSubmissionPrompt('');
      setCopyStatus('');
    }, 1000);
  }

  const currentScene = activeVideo.scenes?.find((scene) => currentTime >= scene.start && currentTime <= scene.end);
  const duration = videoRef.current?.duration || activeVideo.scenes?.at(-1)?.end || 0;

  return (
    <main className="app-shell review-only">
      <header className="topbar compact">
        <div>
          <span className="product-kicker">SHOT REVIEW DESK</span>
          <h1>分镜视频预览台</h1>
        </div>
        <div className="stage-meta">
          <span>{projectTitle}</span>
        </div>
      </header>

      <section className="workspace review-workspace">
        <aside className="sidebar left-panel">
          <div className="panel-heading">
            <span>视频列表</span>
            <div className="video-heading-actions">
              <strong>{videos.length || 0} 条</strong>
              <button className="clear-video-list-button" onClick={clearVideoList}>
                清空
              </button>
            </div>
          </div>
          {videos.length === 0 ? (
            <div className="file-drop empty-upload">
              <span>通过源文件路径接入视频</span>
              <small>使用 npm run load，不复制、不缓存视频</small>
            </div>
          ) : (
            <div className="video-list">
              {videos.map((video, index) => {
                const count = annotations.filter((item) => item.videoId === video.id).length;
                return (
                  <button
                    className={video.id === activeVideo.id ? 'active' : ''}
                    key={video.id}
                    onClick={() => selectVideo(video.id)}
                  >
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <strong>{video.title}</strong>
                    <small>{count} 条意见</small>
                  </button>
                );
              })}
            </div>
          )}
          <button className="clear-video-list-button clear-video-list-wide" onClick={clearVideoList}>
            清空视频列表
          </button>

          {activeVideo.videoUrl && (
            <>
              <div className="panel-heading section-heading">
                <span>镜头段</span>
                <strong>{activeVideo.scenes?.length || 1}</strong>
              </div>
              <div className="scene-list">
                {(activeVideo.scenes?.length
                  ? activeVideo.scenes
                  : [{ id: 'full', title: '完整预览', start: 0, end: duration }]
                ).map((scene) => (
                  <button
                    key={scene.id}
                    className={currentTime >= scene.start && (!scene.end || currentTime <= scene.end) ? 'active' : ''}
                    onClick={() => seek(scene.start)}
                  >
                    <span>{scene.title}</span>
                    <small>
                      {formatTime(scene.start)}
                      {scene.end ? ` - ${formatTime(scene.end)}` : ''}
                    </small>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        <section className="stage-wrap">
          <div className="stage-toolbar">
            <span>{activeVideo.title}</span>
            <small>{currentScene ? currentScene.title : formatTime(currentTime)}</small>
          </div>
          <div className="stage-shell">
            <div
              className="stage-canvas review-canvas"
              style={{ aspectRatio: `${videoAspect}` }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setDraftShape(null)}
            >
              {activeVideo.videoUrl ? (
                <video
                  ref={videoRef}
                  src={activeVideo.videoUrl}
                  className="review-video"
                  onTimeUpdate={(event) => setCurrentTime(Number(event.currentTarget.currentTime.toFixed(1)))}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    setCurrentTime(Number(video.currentTime.toFixed(1)));
                    if (video.videoWidth && video.videoHeight) {
                      setVideoAspect(video.videoWidth / video.videoHeight);
                    }
                  }}
                  controls={false}
                />
              ) : (
                <div className="empty-preview">导入视频后开始审片</div>
              )}

              <div className="annotation-layer">
                {visibleAnnotations.map((item) => (
                  <span
                    key={item.id}
                    className={`mark-box mark-shape ${item.status}`}
                    style={{
                      left: `${item.x}%`,
                      top: `${item.y}%`,
                      width: `${item.width || 0}%`,
                      height: `${item.height || 0}%`,
                    }}
                  />
                ))}
                {pendingAnnotation && pendingAnnotation.videoId === activeVideo.id && (
                  <span
                    className="mark-box mark-pending"
                    style={{
                      left: `${pendingAnnotation.shape.x}%`,
                      top: `${pendingAnnotation.shape.y}%`,
                      width: `${pendingAnnotation.shape.width}%`,
                      height: `${pendingAnnotation.shape.height}%`,
                    }}
                  />
                )}
                {draftShape && (
                  <span
                    className="mark-box mark-draft"
                    style={{
                      left: `${draftShape.x}%`,
                      top: `${draftShape.y}%`,
                      width: `${draftShape.width}%`,
                      height: `${draftShape.height}%`,
                    }}
                  />
                )}
              </div>

              <div className="floating-notes">
                {visibleAnnotations.map((item, index) => (
                  <button
                    key={item.id}
                    className={`note-chip ${item.status}`}
                    style={{ left: `${item.x}%`, top: `${item.y}%` }}
                    onClick={() => toggleStatus(item.id)}
                  >
                    {index + 1}
                  </button>
                ))}
              </div>

              {pendingAnnotation && pendingAnnotation.videoId === activeVideo.id && (
                <div
                  className="inline-note-editor"
                >
                  <strong>{formatTime(pendingAnnotation.time)} 修改建议</strong>
                  <textarea
                    value={noteText}
                    onChange={(event) => setNoteText(event.target.value)}
                    onKeyDown={handleNoteKeyDown}
                    placeholder="例如：这里文字太贴边，往右移动一点"
                    autoFocus
                  />
                  <div>
                    <button onClick={() => setPendingAnnotation(null)}>取消</button>
                    <button onClick={savePendingAnnotation} disabled={!noteText.trim()}>
                      记录意见
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="transport">
            <button onClick={() => setIsPlaying((current) => !current)} disabled={!activeVideo.videoUrl}>
              {isPlaying ? '暂停' : '播放'}
            </button>
            <input
              type="range"
              min="0"
              max={duration}
              step="0.1"
              value={currentTime}
              disabled={!activeVideo.videoUrl}
              onChange={(event) => seek(Number(event.target.value))}
            />
            <span>{formatTime(currentTime)}</span>
          </div>
        </section>

        <aside className="sidebar right-panel review-panel">
          <div className="panel-block">
            <div className="panel-heading">
              <span>标注工具</span>
              <strong>{activeVideoTodoCount} 条待改</strong>
            </div>
            <div className="file-drop compact-upload">
              <span>换视频请重新执行 npm run load</span>
            </div>
            <div className="button-grid">
              <button onClick={clearCurrentMarks} disabled={activeVideoAnnotations.length === 0}>
                清除本条标记
              </button>
              <button className="secondary-action" onClick={clearAllMarks} disabled={annotations.length === 0}>
                清除全部标记
              </button>
            </div>
          </div>

          <div className="opinion-panel">
            <div className="panel-heading compact-heading">
              <span>修改意见汇总</span>
              <strong>{annotations.length} 条</strong>
            </div>
            <div className="annotation-list">
              {annotations.length === 0 && (
                <div className="empty-state">在预览区拖出选框，弹窗里输入修改建议，按回车确认。</div>
              )}
              {annotations.map((item) => {
                const video = videos.find((videoItem) => videoItem.id === item.videoId);
                return (
                  <article className={`annotation-card ${item.status}`} key={item.id}>
                    <div className="annotation-topline">
                      <button className="status-dot" onClick={() => toggleStatus(item.id)}>
                        {item.status === 'done' ? '已处理' : '待处理'}
                      </button>
                      <strong>{formatTime(item.time)}</strong>
                    </div>
                    <small>{video?.title || '当前视频'}</small>
                    <textarea
                      value={item.note}
                      onChange={(event) =>
                        setAnnotations((current) =>
                          current.map((currentItem) =>
                            currentItem.id === item.id ? { ...currentItem, note: event.target.value } : currentItem,
                          ),
                        )
                      }
                    />
                    <button className="text-button" onClick={() => removeAnnotation(item.id)}>
                      删除
                    </button>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="action-stack">
            <button className="export-button" onClick={submitRevisionRequest} disabled={annotations.length === 0}>
              提交修改并重新渲染
            </button>
          </div>
        </aside>
      </section>

      {submissionPrompt && (
        <div className="submit-modal">
          <section>
            <div className="submit-modal-heading">
              <strong>修改请求已生成</strong>
              <button onClick={() => setSubmissionPrompt('')}>关闭</button>
            </div>
            <textarea className={copyStatus ? 'copied' : ''} value={submissionPrompt} readOnly />
            <div className="submit-modal-actions">
            <button onClick={copySubmissionPrompt}>复制提示词</button>
              <button
                onClick={() => {
                  setSubmissionPrompt('');
                  setCopyStatus('');
                }}
              >
                回到审片
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

export default App;
