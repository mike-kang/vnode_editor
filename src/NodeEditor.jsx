// NodeEditor.jsx
import React, { useState, useRef } from "react";

function createIdGenerator(prefix) {
  let i = 1;
  return () => `${prefix}_${i++}`;
}

const genNodeId = createIdGenerator("node");
const genPortId = createIdGenerator("port");
const genEdgeId = createIdGenerator("edge");

/**
 * 노드 에디터 메인 컴포넌트
 */
export default function NodeEditor() {
  // 노드, 포트, 엣지 상태 -----------------------------
  const [nodes, setNodes] = useState(() => [
    {
      id: genNodeId(),
      x: 100,
      y: 100,
      width: 160,
      height: 80,
      title: "Node A",
      inputs: [], // portId 배열
      outputs: [],
    },
    {
      id: genNodeId(),
      x: 400,
      y: 250,
      width: 160,
      height: 80,
      title: "Node B",
      inputs: [],
      outputs: [],
    },
  ]);

  const [ports, setPorts] = useState([]); // {id, nodeId, side, index}
  const [edges, setEdges] = useState([]); // {id, fromPortId, toPortId}

  // 드래그 중인 임시 연결 상태 ------------------------
  const [draggingConnection, setDraggingConnection] = useState(null);
  // draggingConnection = { fromPortId, x, y }

  const svgRef = useRef(null);

  // 유틸: node에서 포트 위치 계산 ----------------------
  function getPortPosition(port) {
    const node = nodes.find((n) => n.id === port.nodeId);
    if (!node) return { x: 0, y: 0 };

    const isLeft = port.side === "left";
    const list = isLeft ? node.inputs : node.outputs;
    const index = list.indexOf(port.id);

    const spacing = 20;
    const startY = node.y + 30; // 타이틀 아래쪽부터
    const y = startY + index * spacing;
    const x = isLeft ? node.x : node.x + node.width;

    return { x, y };
  }

  function getPortById(id) {
    return ports.find((p) => p.id === id);
  }

  // 노드에 포트 추가 -----------------------------------
  function addPort(nodeId, side) {
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        const portId = genPortId();
        if (side === "left") {
          return { ...n, inputs: [...n.inputs, portId] };
        } else {
          return { ...n, outputs: [...n.outputs, portId] };
        }
      })
    );

    setPorts((prev) => [
      ...prev,
      {
        id: genPortId(), // 포트 객체용 별도 id를 쓰고 싶다면 이렇게, 
        // but 간단하게 node의 inputs/outputs에 저장하는 id와 동일하게 쓰고 싶으면 위와 맞춰도 됨.
        // 여기선 간단하게 inputs/outputs에 저장되는 id를 그대로 쓰자.
      },
    ]);
  }

  // 위에서 포트 id를 두 번 생성했네? → 정리 버전
  // 실제로는 addPort를 이렇게 다시 정의하는 게 깔끔하다:

  function addPortFixed(nodeId, side) {
    const newPortId = genPortId();
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        if (side === "left") {
          return { ...n, inputs: [...n.inputs, newPortId] };
        } else {
          return { ...n, outputs: [...n.outputs, newPortId] };
        }
      })
    );
    setPorts((prev) => [
      ...prev,
      {
        id: newPortId,
        nodeId,
        side, // 'left' | 'right'
      },
    ]);
  }

  // 위의 잘못된 addPort를 덮어씌우기 위해 한번 더 선언
  // (JS 함수 선언 호이스팅 특성을 이용)
  function addPort(nodeId, side) {
    addPortFixed(nodeId, side);
  }

  // 포트 삭제 (우클릭) ---------------------------------
  function removePort(portId) {
    const port = getPortById(portId);
    if (!port) return;

    // 노드에서 포트 제거
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== port.nodeId) return n;
        if (port.side === "left") {
          return { ...n, inputs: n.inputs.filter((id) => id !== portId) };
        } else {
          return { ...n, outputs: n.outputs.filter((id) => id !== portId) };
        }
      })
    );

    // 포트 리스트에서 제거
    setPorts((prev) => prev.filter((p) => p.id !== portId));

    // 연결된 엣지 제거
    setEdges((prev) =>
      prev.filter(
        (e) => e.fromPortId !== portId && e.toPortId !== portId
      )
    );
  }

  // 연결 생성 ------------------------------------------
  function createEdge(fromPortId, toPortId) {
    const from = getPortById(fromPortId);
    const to = getPortById(toPortId);
    if (!from || !to) return;

    // 같은 방향끼리 연결 금지 (왼↔왼, 오른↔오른)
    if (from.side === to.side) return;

    // 중복 연결 방지
    const exists = edges.some(
      (e) =>
        (e.fromPortId === fromPortId && e.toPortId === toPortId) ||
        (e.fromPortId === toPortId && e.toPortId === fromPortId)
    );
    if (exists) return;

    // 방향은 left → right 형태로 통일
    let realFrom = from;
    let realTo = to;
    if (from.side === "right") {
      realFrom = to;
      realTo = from;
    }

    setEdges((prev) => [
      ...prev,
      {
        id: genEdgeId(),
        fromPortId: realFrom.id,
        toPortId: realTo.id,
      },
    ]);
  }

  // 포트 클릭 & 드래그 시작 (좌클릭) --------------------
  function handlePortMouseDown(e, portId) {
    if (e.button !== 0) return; // 왼쪽 버튼만
    e.stopPropagation();
    const port = getPortById(portId);
    if (!port) return;
    const { x, y } = getPortPosition(port);
    setDraggingConnection({ fromPortId: portId, x, y });
  }

  // 포트 위에서 마우스 업 → 연결 완료 시도 -------------
  function handlePortMouseUp(e, portId) {
    e.stopPropagation();
    if (!draggingConnection) return;

    const fromId = draggingConnection.fromPortId;
    if (fromId === portId) {
      setDraggingConnection(null);
      return;
    }
    createEdge(fromId, portId);
    setDraggingConnection(null);
  }

  // 포트 우클릭 → 제거 --------------------------------
  function handlePortContextMenu(e, portId) {
    e.preventDefault();
    e.stopPropagation();
    removePort(portId);
  }

  // SVG 배경에서 드래그 중: 임시 선 위치 업데이트 ------
  function handleSvgMouseMove(e) {
    if (!draggingConnection) return;
    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    setDraggingConnection((prev) =>
      prev ? { ...prev, x: cursor.x, y: cursor.y } : null
    );
  }

  // SVG 배경에서 마우스 업 → 연결 취소 -----------------
  function handleSvgMouseUp() {
    if (draggingConnection) {
      setDraggingConnection(null);
    }
  }

  // 노드 추가 버튼 (테스트용) ---------------------------
  function handleAddNode() {
    setNodes((prev) => [
      ...prev,
      {
        id: genNodeId(),
        x: 250,
        y: 400,
        width: 160,
        height: 80,
        title: "New Node",
        inputs: [],
        outputs: [],
      },
    ]);
  }

  // 렌더링 ---------------------------------------------
  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        color: "#eee",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button onClick={handleAddNode}>노드 추가</button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          - 노드 좌/우 '+' 클릭: 포트 추가<br />
          - 포트 좌클릭 드래그 → 다른 쪽 포트에 놓으면 연결<br />
          - 포트 우클릭 → 포트 삭제
        </span>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ flex: 1, background: "#252526" }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
      >
        {/* 엣지(선) */}
        {edges.map((edge) => {
          const from = getPortById(edge.fromPortId);
          const to = getPortById(edge.toPortId);
          if (!from || !to) return null;
          const p1 = getPortPosition(from);
          const p2 = getPortPosition(to);

          // 약간 곡선으로 그려도 됨. 여기선 직선.
          return (
            <line
              key={edge.id}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#8be9fd"
              strokeWidth="2"
            />
          );
        })}

        {/* 드래그 중 임시 선 */}
        {draggingConnection && (() => {
          const from = getPortById(draggingConnection.fromPortId);
          if (!from) return null;
          const start = getPortPosition(from);
          const end = { x: draggingConnection.x, y: draggingConnection.y };
          return (
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#ffb86c"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          );
        })()}

        {/* 노드들 */}
        {nodes.map((node) => (
          <g key={node.id}>
            {/* 노드 박스 */}
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx="8"
              ry="8"
              fill="#3c3c3c"
              stroke="#555"
              strokeWidth="1"
            />
            {/* 타이틀 */}
            <text
              x={node.x + 8}
              y={node.y + 20}
              fill="#fff"
              fontSize="12"
            >
              {node.title}
            </text>

            {/* 왼쪽 + 버튼 */}
            <g
              onClick={() => addPort(node.id, "left")}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x - 18}
                y={node.y + node.height / 2 - 10}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x - 10}
                y={node.y + node.height / 2 + 1}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 오른쪽 + 버튼 */}
            <g
              onClick={() => addPort(node.id, "right")}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x + node.width + 2}
                y={node.y + node.height / 2 - 10}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x + node.width + 10}
                y={node.y + node.height / 2 + 1}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 왼쪽 포트들 */}
            {node.inputs.map((portId, idx) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#50fa7b"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}

            {/* 오른쪽 포트들 */}
            {node.outputs.map((portId, idx) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#ff79c6"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
